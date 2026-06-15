import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { GoogleCompleteDto } from './dto/google-complete.dto';
import { Prisma, UserRole } from '@prisma/client';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h

type TokenUser = { id: string; email: string; role: UserRole };

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private mailService: MailService,
  ) {}

  private generateToken(): { plain: string; hash: string } {
    const plain = randomBytes(32).toString('hex');
    const hash = require('crypto')
      .createHash('sha256')
      .update(plain)
      .digest('hex');
    return { plain, hash };
  }

  private frontendUrl() {
    return process.env.FRONTEND_URL || 'http://localhost:3000';
  }

  private generateTokens(user: TokenUser) {
    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = this.jwtService.sign(payload, { expiresIn: '15m' });

    const refreshPayload = { ...payload, jti: randomUUID() };
    const refreshToken = this.jwtService.sign(refreshPayload, {
      expiresIn: '7d',
    });

    return { accessToken, refreshToken };
  }

  private async updateRefreshToken(userId: string, refreshToken: string) {
    const hashedRefreshToken = await bcrypt.hash(refreshToken, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: hashedRefreshToken },
    });
  }

  async register(registerDto: RegisterDto) {
    const {
      name,
      email,
      password,
      role,
      phoneNumber,
      whatsappNumber,
      referralCode,
    } = registerDto;

    if (!name || !email || !password || !role || !phoneNumber) {
      throw new BadRequestException('All fields are required');
    }

    if (role === UserRole.ADMIN) {
      throw new BadRequestException('ADMIN cannot self-register');
    }

    if (role === UserRole.TUTOR && !whatsappNumber) {
      throw new BadRequestException('whatsappNumber is required for tutors');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // resolve referrer (referralCode → User.id)
    let referredById: string | null = null;
    if (referralCode) {
      const ref = await this.prisma.user.findUnique({
        where: { referralCode },
        select: { id: true },
      });
      referredById = ref?.id ?? null;
    }
    // generate this user's own referralCode
    const myReferralCode = randomBytes(4).toString('hex').toUpperCase();

    try {
      const { user, profileId } = await this.prisma.$transaction(async (tx) => {
        const createdUser = await tx.user.create({
          data: {
            name,
            email,
            password: hashedPassword,
            role,
            phoneNumber,
            referralCode: myReferralCode,
            referredById,
          },
        });

        let pid: string;
        if (role === UserRole.TUTOR) {
          const tutorProfile = await tx.tutorProfile.create({
            data: {
              userId: createdUser.id,
              bio: '',
              subjects: [],
              experience: 0,
              hourlyRate: 0,
              whatsappNumber: whatsappNumber!,
            },
          });
          pid = tutorProfile.id;
        } else if (role === UserRole.STUDENT) {
          const studentProfile = await tx.studentProfile.create({
            data: {
              userId: createdUser.id,
              bio: '',
              interests: [],
              whatsappNumber: whatsappNumber ?? null,
            },
          });
          pid = studentProfile.id;
        } else {
          throw new BadRequestException('Invalid user role');
        }

        return { user: createdUser, profileId: pid };
      });

      const { accessToken, refreshToken } = this.generateTokens(user);
      await this.updateRefreshToken(user.id, refreshToken);

      // fire-and-forget email verification
      this.sendVerificationToken(user.id, user.email).catch((err) =>
        console.error('Failed to send verification email', err),
      );

      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          profileId,
        },
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Email or phone number already exists');
      }
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Failed to register user');
    }
  }

  private async sendVerificationToken(userId: string, email: string) {
    const { plain, hash } = this.generateToken();
    await this.prisma.emailVerificationToken.create({
      data: {
        userId,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
      },
    });
    const url = `${this.frontendUrl()}/verify-email?token=${plain}`;
    await this.mailService.sendEmailVerification(email, url);
  }

  async resendVerification(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.emailVerifiedAt) return { ok: true };
    await this.sendVerificationToken(user.id, user.email);
    return { ok: true };
  }

  async verifyEmail(plainToken: string) {
    const hash = require('crypto')
      .createHash('sha256')
      .update(plainToken)
      .digest('hex');
    const row = await this.prisma.emailVerificationToken.findFirst({
      where: { tokenHash: hash, usedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!row) throw new BadRequestException('Invalid or expired token');
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: row.userId },
        data: { emailVerifiedAt: new Date() },
      }),
    ]);
    return { ok: true };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return { ok: true }; // no enumeration
    const { plain, hash } = this.generateToken();
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });
    const url = `${this.frontendUrl()}/reset-password?token=${plain}`;
    await this.mailService.sendPasswordResetEmail(user.email, url);
    return { ok: true };
  }

  async resetPassword(plainToken: string, newPassword: string) {
    const hash = require('crypto')
      .createHash('sha256')
      .update(plainToken)
      .digest('hex');
    const row = await this.prisma.passwordResetToken.findFirst({
      where: { tokenHash: hash, usedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!row) throw new BadRequestException('Invalid or expired token');
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: row.userId },
        data: { password: hashedPassword, refreshToken: null },
      }),
    ]);
    return { ok: true };
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    if (!email || !password) {
      throw new BadRequestException('Email and password are required');
    }

    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || !user.password || !(await bcrypt.compare(password, user.password))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const { accessToken, refreshToken } = this.generateTokens(user);
    await this.updateRefreshToken(user.id, refreshToken);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  async refreshToken(refreshTokenDto: RefreshTokenDto) {
    const { refreshToken } = refreshTokenDto;

    try {
      const payload = this.jwtService.verify(refreshToken) as {
        sub: string;
        email: string;
        role: UserRole;
        jti: string;
      };

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user || !user.refreshToken) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const refreshTokenMatches = await bcrypt.compare(
        refreshToken,
        user.refreshToken,
      );

      if (!refreshTokenMatches) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const { accessToken, refreshToken: newRefreshToken } =
        this.generateTokens(user);
      await this.updateRefreshToken(user.id, newRefreshToken);

      return {
        access_token: accessToken,
        refresh_token: newRefreshToken,
      };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async adminMarkVerified(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    return this.prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
      select: { id: true, email: true, emailVerifiedAt: true },
    });
  }

  async createAdmin(input: {
    name: string;
    email: string;
    password: string;
    phoneNumber: string;
  }) {
    const { name, email, password, phoneNumber } = input;
    if (!name || !email || !password || !phoneNumber) {
      throw new BadRequestException('All fields are required');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    try {
      return await this.prisma.user.create({
        data: {
          name,
          email,
          password: hashedPassword,
          phoneNumber,
          role: UserRole.ADMIN,
        },
        select: { id: true, name: true, email: true, role: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Email or phone number already exists');
      }
      throw new BadRequestException('Failed to create admin');
    }
  }

  async logout(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });

    return { message: 'Logged out successfully' };
  }

  async googleCallback(googleUser: {
    googleId: string;
    email: string;
    name: string;
    picture?: string;
  }) {
    if (!googleUser.email) {
      throw new BadRequestException('Google account has no verified email');
    }

    let user = await this.prisma.user.findFirst({
      where: {
        OR: [{ googleId: googleUser.googleId }, { email: googleUser.email }],
      },
    });

    if (user) {
      // Link Google ID and auto-verify email if not already done
      if (!user.googleId || !user.emailVerifiedAt) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: {
            googleId: user.googleId ?? googleUser.googleId,
            emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
          },
        });
      }

      const exchangeCode = this.jwtService.sign(
        { sub: user.id, type: 'google_exchange' },
        { expiresIn: '5m' },
      );
      return { type: 'existing' as const, code: exchangeCode };
    }

    // New user — store profile in a short-lived JWT; no DB record yet
    const pendingCode = this.jwtService.sign(
      {
        googleId: googleUser.googleId,
        email: googleUser.email,
        name: googleUser.name,
        picture: googleUser.picture,
        type: 'google_pending',
      },
      { expiresIn: '10m' },
    );
    return { type: 'new' as const, code: pendingCode };
  }

  async googleExchange(code: string) {
    let payload: { sub: string; type: string };
    try {
      payload = this.jwtService.verify(code) as { sub: string; type: string };
    } catch {
      throw new UnauthorizedException('Invalid or expired code');
    }

    if (payload.type !== 'google_exchange') {
      throw new UnauthorizedException('Invalid code type');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user) throw new UnauthorizedException('User not found');

    const { accessToken, refreshToken } = this.generateTokens(user);
    await this.updateRefreshToken(user.id, refreshToken);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  }

  async googleComplete(dto: GoogleCompleteDto) {
    const { code, role, phoneNumber, whatsappNumber } = dto;

    let payload: {
      googleId: string;
      email: string;
      name: string;
      picture?: string;
      type: string;
    };
    try {
      payload = this.jwtService.verify(code) as typeof payload;
    } catch {
      throw new UnauthorizedException('Invalid or expired code');
    }

    if (payload.type !== 'google_pending') {
      throw new UnauthorizedException('Invalid code type');
    }

    if (role === UserRole.ADMIN) {
      throw new BadRequestException('Cannot register as ADMIN');
    }

    if (role === UserRole.TUTOR && !whatsappNumber) {
      throw new BadRequestException('whatsappNumber is required for tutors');
    }

    const myReferralCode = randomBytes(4).toString('hex').toUpperCase();

    try {
      const { user, profileId } = await this.prisma.$transaction(async (tx) => {
        const createdUser = await tx.user.create({
          data: {
            name: payload.name,
            email: payload.email,
            googleId: payload.googleId,
            role,
            phoneNumber,
            referralCode: myReferralCode,
            emailVerifiedAt: new Date(),
          },
        });

        let pid: string;
        if (role === UserRole.TUTOR) {
          const tutorProfile = await tx.tutorProfile.create({
            data: {
              userId: createdUser.id,
              bio: '',
              subjects: [],
              experience: 0,
              hourlyRate: 0,
              whatsappNumber: whatsappNumber!,
            },
          });
          pid = tutorProfile.id;
        } else {
          const studentProfile = await tx.studentProfile.create({
            data: {
              userId: createdUser.id,
              bio: '',
              interests: [],
            },
          });
          pid = studentProfile.id;
        }

        return { user: createdUser, profileId: pid };
      });

      const { accessToken, refreshToken } = this.generateTokens(user);
      await this.updateRefreshToken(user.id, refreshToken);

      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          profileId,
        },
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Email or phone number already in use');
      }
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Failed to complete registration');
    }
  }
}
