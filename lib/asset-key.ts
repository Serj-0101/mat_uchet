export type ComparisonFields = {
  name: string;
  inventoryNumber: string;
  acceptedDate: string;
};

const cleanKeyPart = (value: unknown) => String(value ?? "").trim();

export function getComparisonBase(row: ComparisonFields) {
  return JSON.stringify([
    cleanKeyPart(row.name),
    cleanKeyPart(row.inventoryNumber),
    cleanKeyPart(row.acceptedDate),
  ]);
}

export function assignRecordKeys<T extends ComparisonFields>(rows: T[]): Array<T & { recordKey: string }> {
  const occurrences = new Map<string, number>();
  return rows.map((row) => {
    const base = getComparisonBase(row);
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    return { ...row, recordKey: `${base}#${occurrence}` };
  });
}
