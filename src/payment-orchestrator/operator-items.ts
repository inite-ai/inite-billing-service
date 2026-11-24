/**
 * Something about money that only a person can decide. Written once per `key`,
 * in the caller's transaction, and read on /v1/admin/operator-items. It moves
 * and grants nothing.
 */
export async function noteForOperator(
  tx: any,
  item: {
    kind: string;
    key: string;
    subscriptionId?: string;
    orderId?: string;
    detail: Record<string, unknown>;
  },
): Promise<void> {
  const key = `${item.kind}:${item.key}`.slice(0, 255);
  await tx.operatorItem.upsert({
    where: { key },
    update: {},
    create: {
      key,
      kind: item.kind,
      subscriptionId: item.subscriptionId ?? null,
      orderId: item.orderId ?? null,
      detail: item.detail,
    },
  });
}
