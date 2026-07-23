import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import {
  Offer,
  OfferDocument,
  OfferProposer,
  OfferStatus,
} from './schemas/offer.schema';
import { ListingsService } from '../listings/listings.service';
import { CreateOfferDto } from './dto/create-offer.dto';
import { CounterOfferDto } from './dto/counter-offer.dto';
import { ListOffersDto } from './dto/list-offers.dto';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class OffersService {
  constructor(
    @InjectModel(Offer.name) private offerModel: Model<OfferDocument>,
    private readonly listingsService: ListingsService,
    private readonly notificationsService: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  async create(buyerId: string, dto: CreateOfferDto): Promise<OfferDocument> {
    const listing = await this.listingsService.findById(dto.listingId);

    if (listing.seller.toString() === buyerId) {
      throw new BadRequestException(
        'You cannot make an offer on your own listing',
      );
    }

    const existingPending = await this.offerModel.findOne({
      listing: dto.listingId,
      buyer: buyerId,
      status: OfferStatus.PENDING,
    });
    if (existingPending) {
      throw new ConflictException(
        'You already have a pending offer on this listing — wait for a response or withdraw it first',
      );
    }

    const offer = await this.offerModel.create({
      listing: dto.listingId,
      buyer: buyerId,
      seller: listing.seller,
      amount: dto.amount,
      proposedBy: OfferProposer.BUYER,
      status: OfferStatus.PENDING,
      expiresAt: this.computeExpiry(),
    });

    await this.notificationsService.notifyUser(listing.seller.toString(), {
      title: 'New offer received',
      body: `You received an offer of ₦${dto.amount.toLocaleString()} on "${listing.title}".`,
      data: { type: 'offer_received', offerId: offer._id.toString() },
    });

    return offer;
  }

  async findById(id: string, userId: string): Promise<OfferDocument> {
    const offer = await this.findParty(id, userId);
    return offer;
  }

  async accept(id: string, userId: string): Promise<OfferDocument> {
    const offer = await this.findRespondable(id, userId);
    offer.status = OfferStatus.ACCEPTED;
    await offer.save();

    await this.notifyProposer(
      offer,
      'offer_accepted',
      'Offer accepted',
      'Your offer was accepted — proceed to checkout.',
    );
    return offer;
  }

  async reject(id: string, userId: string): Promise<OfferDocument> {
    const offer = await this.findRespondable(id, userId);
    offer.status = OfferStatus.REJECTED;
    await offer.save();

    await this.notifyProposer(
      offer,
      'offer_rejected',
      'Offer rejected',
      'Your offer was rejected.',
    );
    return offer;
  }

  async counter(
    id: string,
    userId: string,
    dto: CounterOfferDto,
  ): Promise<OfferDocument> {
    const offer = await this.findRespondable(id, userId);

    offer.status = OfferStatus.COUNTERED;
    await offer.save();

    const counterProposer =
      offer.proposedBy === OfferProposer.BUYER
        ? OfferProposer.SELLER
        : OfferProposer.BUYER;

    const newOffer = await this.offerModel.create({
      listing: offer.listing,
      buyer: offer.buyer,
      seller: offer.seller,
      amount: dto.amount,
      proposedBy: counterProposer,
      parentOffer: offer._id,
      status: OfferStatus.PENDING,
      expiresAt: this.computeExpiry(),
    });

    // Whoever DIDN'T make this counter is the one who now needs to respond.
    const respondentId =
      counterProposer === OfferProposer.BUYER ? offer.seller : offer.buyer;
    await this.notificationsService.notifyUser(respondentId.toString(), {
      title: 'Offer countered',
      body: `The other party countered with ₦${dto.amount.toLocaleString()}.`,
      data: { type: 'offer_countered', offerId: newOffer._id.toString() },
    });

    return newOffer;
  }

  async withdraw(id: string, userId: string): Promise<OfferDocument> {
    const offer = await this.findActive(id);
    const proposerId =
      offer.proposedBy === OfferProposer.BUYER ? offer.buyer : offer.seller;

    if (proposerId.toString() !== userId) {
      throw new ForbiddenException("Only the offer's proposer can withdraw it");
    }
    if (offer.status !== OfferStatus.PENDING) {
      throw new BadRequestException('Only a pending offer can be withdrawn');
    }

    offer.status = OfferStatus.WITHDRAWN;
    await offer.save();
    return offer;
  }

  async listForUser(userId: string, dto: ListOffersDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;

    const results = await this.offerModel
      .find({ $or: [{ buyer: userId }, { seller: userId }] })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .exec();

    return { results, page, limit };
  }

  async adminList(page: number, limit: number) {
    const [results, total] = await Promise.all([
      this.offerModel
        .find({})
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.offerModel.countDocuments({}),
    ]);
    return { results, total, page, limit };
  }

  private async notifyProposer(
    offer: OfferDocument,
    type: string,
    title: string,
    body: string,
  ): Promise<void> {
    const proposerId =
      offer.proposedBy === OfferProposer.BUYER ? offer.buyer : offer.seller;
    await this.notificationsService.notifyUser(proposerId.toString(), {
      title,
      body,
      data: { type, offerId: offer._id.toString() },
    });
  }

  private computeExpiry(): Date {
    const days = this.config.get<number>('OFFER_EXPIRY_DAYS', 3);
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  // Lazily expires a stale pending offer on read/action rather than a
  // scheduled sweep — same interim pattern flagged in CLAUDE.md, to be
  // unified with the stalled-transaction cron job once @nestjs/schedule
  // is introduced in the Payments module.
  private async findActive(id: string): Promise<OfferDocument> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Offer not found');
    }
    const offer = await this.offerModel.findById(id);
    if (!offer) {
      throw new NotFoundException('Offer not found');
    }
    if (offer.status === OfferStatus.PENDING && offer.expiresAt < new Date()) {
      offer.status = OfferStatus.EXPIRED;
      await offer.save();
    }
    return offer;
  }

  private async findParty(id: string, userId: string): Promise<OfferDocument> {
    const offer = await this.findActive(id);
    if (
      offer.buyer.toString() !== userId &&
      offer.seller.toString() !== userId
    ) {
      throw new ForbiddenException('You are not a party to this offer');
    }
    return offer;
  }

  private async findRespondable(
    id: string,
    userId: string,
  ): Promise<OfferDocument> {
    const offer = await this.findParty(id, userId);

    const responderId =
      offer.proposedBy === OfferProposer.BUYER ? offer.seller : offer.buyer;
    if (responderId.toString() !== userId) {
      throw new ForbiddenException(
        'It is not your turn to respond to this offer',
      );
    }
    if (offer.status !== OfferStatus.PENDING) {
      throw new BadRequestException(
        `Offer is ${offer.status}, no longer actionable`,
      );
    }

    return offer;
  }
}
