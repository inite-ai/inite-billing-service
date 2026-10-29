-- A service acts on billing's service API with an INITE Auth client_credentials
-- token; this names the OAuth client that is that service. Additive only.

-- AlterTable
ALTER TABLE "billing"."services" ADD COLUMN     "auth_client_id" VARCHAR(255);

-- CreateIndex
CREATE UNIQUE INDEX "services_auth_client_id_key" ON "billing"."services"("auth_client_id");
