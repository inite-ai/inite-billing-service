import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module';
import { PaymentOrchestratorModule } from '../payment-orchestrator/payment-orchestrator.module';
import { PrismaService } from '../common/services/prisma.service';
import { InvoicingService } from './invoicing.service';
import { ServiceInvoicesController } from './service-invoices.controller';
import { AdminInvoicesController } from './admin-invoices.controller';

@Module({
  imports: [CheckoutModule, PaymentOrchestratorModule],
  controllers: [ServiceInvoicesController, AdminInvoicesController],
  providers: [InvoicingService, PrismaService],
  exports: [InvoicingService],
})
export class InvoicingModule {}
