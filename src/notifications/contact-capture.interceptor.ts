import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { UserContactService } from './user-contact.service';

/**
 * Lazily captures email (from the JWT claim) and locale (from the
 * X-User-Locale header / locale cookie) into UserContact on any
 * authenticated request. Interceptors run after guards, so req.user is set.
 */
@Injectable()
export class ContactCaptureInterceptor implements NestInterceptor {
  constructor(private readonly userContactService: UserContactService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    try {
      const req = context.switchToHttp().getRequest();
      const user = req?.user;
      if (user?.userId && !user.isService) {
        const locale =
          (req.headers?.['x-user-locale'] as string) || req.cookies?.locale;
        void this.userContactService.touch(user.userId, user.email, locale);
      }
    } catch {
      // contact capture must never affect request handling
    }
    return next.handle();
  }
}
