// endDate is treated as inclusive through the end of that calendar day, so
// startDate=endDate (a single day) still matches records created any time
// that day, not just exactly midnight.
export function buildDateRangeFilter(
  dto: { startDate?: string; endDate?: string },
  field = 'createdAt',
): Record<string, { $gte?: Date; $lte?: Date }> {
  if (!dto.startDate && !dto.endDate) return {};

  const range: { $gte?: Date; $lte?: Date } = {};
  if (dto.startDate) {
    range.$gte = new Date(dto.startDate);
  }
  if (dto.endDate) {
    const end = new Date(dto.endDate);
    end.setUTCHours(23, 59, 59, 999);
    range.$lte = end;
  }
  return { [field]: range };
}
