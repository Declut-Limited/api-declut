import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Escrow, EscrowSchema } from './schemas/escrow.schema';
import { EscrowService } from './escrow.service';
import { AdminEscrowController } from './admin-escrow.controller';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { CounterModule } from '../common/counter/counter.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Escrow.name, schema: EscrowSchema }]),
    AdminAuthModule,
    CounterModule,
  ],
  controllers: [AdminEscrowController],
  providers: [EscrowService],
  exports: [EscrowService],
})
export class EscrowModule {}
