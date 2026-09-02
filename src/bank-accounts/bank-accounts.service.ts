import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import {
  BankAccount,
  BankAccountDocument,
} from './schemas/bank-account.schema';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';
import { PaystackService } from '../payments/paystack.service';
import { AuditLogService } from '../audit-log/audit-log.service';

@Injectable()
export class BankAccountsService {
  constructor(
    @InjectModel(BankAccount.name)
    private bankAccountModel: Model<BankAccountDocument>,
    private readonly paystackService: PaystackService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(userId: string, dto: CreateBankAccountDto) {
    const existing = await this.bankAccountModel.findOne({ user: userId });
    if (existing) {
      throw new ConflictException(
        'A bank account already exists for this user — use the edit endpoint to change it',
      );
    }

    const resolved = await this.resolveAndValidate(
      dto.bankCode,
      dto.accountNumber,
    );

    const bankAccount = await this.bankAccountModel.create({
      user: userId,
      bankCode: dto.bankCode,
      shortName: resolved.bankName,
      fullName: resolved.bankName,
      accountNumber: dto.accountNumber,
      maskedAccountNumber: this.maskAccountNumber(dto.accountNumber),
      accountHolderName: resolved.accountHolderName,
    });

    await this.auditLogService.record({
      entityType: 'bank_account',
      entityId: bankAccount._id.toString(),
      event: 'bank_account.created',
      actor: userId,
    });

    return this.shape(bankAccount);
  }

  async update(userId: string, id: string, dto: UpdateBankAccountDto) {
    const bankAccount = await this.findOwned(id, userId);

    // Only re-resolve against Paystack if bankCode/accountNumber actually
    // changed — no reason to burn an external call re-confirming the same
    // pair that's already stored.
    if (dto.bankCode !== undefined || dto.accountNumber !== undefined) {
      const bankCode = dto.bankCode ?? bankAccount.bankCode;
      const accountNumber = dto.accountNumber ?? bankAccount.accountNumber;
      const resolved = await this.resolveAndValidate(bankCode, accountNumber);

      bankAccount.bankCode = bankCode;
      bankAccount.shortName = resolved.bankName;
      bankAccount.fullName = resolved.bankName;
      bankAccount.accountNumber = accountNumber;
      bankAccount.maskedAccountNumber = this.maskAccountNumber(accountNumber);
      bankAccount.accountHolderName = resolved.accountHolderName;
      await bankAccount.save();
    }

    await this.auditLogService.record({
      entityType: 'bank_account',
      entityId: id,
      event: 'bank_account.updated',
      actor: userId,
    });

    return this.shape(bankAccount);
  }

  // Object-level ownership check, same as every other mutating/PII-exposing
  // endpoint in this app — a user can only ever see their own bank details.
  async getForUser(requesterId: string, userId: string) {
    if (requesterId !== userId) {
      throw new ForbiddenException('You can only view your own bank account');
    }
    if (!isValidObjectId(userId)) {
      throw new NotFoundException('Bank account not found');
    }
    const bankAccount = await this.bankAccountModel.findOne({ user: userId });
    if (!bankAccount) {
      throw new NotFoundException('Bank account not found');
    }
    return this.shape(bankAccount);
  }

  private async findOwned(
    id: string,
    userId: string,
  ): Promise<BankAccountDocument> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Bank account not found');
    }
    const bankAccount = await this.bankAccountModel.findById(id);
    if (!bankAccount) {
      throw new NotFoundException('Bank account not found');
    }
    if (bankAccount.user.toString() !== userId) {
      throw new ForbiddenException('You do not own this bank account');
    }
    return bankAccount;
  }

  // Cross-checks bankCode against Paystack's own bank list (catches a stale/
  // invalid code before it's stored) and resolves the real account holder
  // name — never trusted from the client, since it gates where a future
  // payout lands.
  private async resolveAndValidate(
    bankCode: string,
    accountNumber: string,
  ): Promise<{ bankName: string; accountHolderName: string }> {
    const banks = await this.paystackService.listBanks();
    const bank = banks.find((b) => b.code === bankCode);
    if (!bank) {
      throw new BadRequestException('Unrecognized bank code');
    }

    const resolved = await this.paystackService.resolveAccountNumber(
      accountNumber,
      bankCode,
    );

    return { bankName: bank.name, accountHolderName: resolved.accountName };
  }

  private maskAccountNumber(accountNumber: string): string {
    return `•••• ${accountNumber.slice(-4)}`;
  }

  private shape(bankAccount: BankAccountDocument): Record<string, unknown> {
    const obj = bankAccount.toObject() as unknown as Record<string, unknown>;
    const { _id, __v, user, ...rest } = obj;
    void __v;
    return {
      id: (_id as Types.ObjectId).toString(),
      userId: (user as Types.ObjectId).toString(),
      ...rest,
    };
  }
}
