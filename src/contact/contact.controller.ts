import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ContactService } from './contact.service';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';

// No guard — the public marketing site's "Get in touch" form, not an
// authenticated in-app action. Same posture as WaitlistController.join().
@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Post()
  @HttpCode(200)
  submit(@Body() dto: CreateContactMessageDto) {
    return this.contactService.submit(dto);
  }
}
