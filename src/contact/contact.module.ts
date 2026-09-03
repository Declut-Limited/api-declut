import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ContactMessage,
  ContactMessageSchema,
} from './schemas/contact-message.schema';
import { ContactService } from './contact.service';
import { ContactController } from './contact.controller';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ContactMessage.name, schema: ContactMessageSchema },
    ]),
    EmailModule,
  ],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
