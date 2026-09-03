import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import {
  ContactMessage,
  ContactMessageDocument,
} from './schemas/contact-message.schema';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';
import { EmailService } from '../email/email.service';

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    @InjectModel(ContactMessage.name)
    private contactMessageModel: Model<ContactMessageDocument>,
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  async submit(dto: CreateContactMessageDto): Promise<{ message: string }> {
    // Required schema field — no fallback value makes sense, so a missing
    // config is a hard error here, same lazy-config pattern as Cloudinary/
    // Paystack/QoreID, distinct from the swallowed email-send failure below.
    const adminEmail = this.config.get<string>('CONTACT_ADMIN_EMAIL');
    if (!adminEmail) {
      throw new InternalServerErrorException(
        'The contact form is not configured on this server yet',
      );
    }

    await this.contactMessageModel.create({
      name: dto.name,
      email: dto.email,
      phone: dto.phone,
      message: dto.message,
      adminEmailSentTo: adminEmail,
    });

    // The message is already saved above — a failed/unconfigured send must
    // not fail the submission, same posture as AuthService.register()'s
    // verification email.
    try {
      await this.emailService.sendContactMessageEmail(adminEmail, {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        message: dto.message,
      });
    } catch (err) {
      this.logger.error(
        `Failed to send contact notification email: ${(err as Error).message}`,
      );
    }

    return { message: "Thanks for reaching out — we'll get back to you soon." };
  }
}
