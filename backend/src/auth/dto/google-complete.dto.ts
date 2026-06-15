import {
  IsEnum,
  IsNotEmpty,
  IsString,
  Matches,
  ValidateIf,
} from 'class-validator';
import { UserRole } from '@prisma/client';

const WA_REGEX = /^\+?[1-9]\d{7,14}$/;

export class GoogleCompleteDto {
  @IsNotEmpty()
  @IsString()
  code: string;

  @IsEnum(UserRole)
  role: UserRole;

  @IsNotEmpty()
  @IsString()
  phoneNumber: string;

  @ValidateIf((o) => o.role === UserRole.TUTOR)
  @IsNotEmpty({ message: 'whatsappNumber is required for tutors' })
  @IsString()
  @Matches(WA_REGEX, { message: 'whatsappNumber must be E.164 format' })
  whatsappNumber?: string;
}
