export async function paginate<T>(
  model: any,
  where: any,
  options: {
    page?: number;
    limit?: number;
    orderBy?: any;
    include?: any;
  },
): Promise<{ items: T[]; total: number; page: number; limit: number; pages: number }> {
  const page = options.page || 1;
  const limit = Math.min(options.limit || 20, 100);
  const [items, total] = await Promise.all([
    model.findMany({
      where,
      ...(options.include ? { include: options.include } : {}),
      ...(options.orderBy ? { orderBy: options.orderBy } : {}),
      skip: (page - 1) * limit,
      take: limit,
    }),
    model.count({ where }),
  ]);
  return { items, total, page, limit, pages: Math.ceil(total / limit) };
}
