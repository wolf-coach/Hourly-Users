export const HOUR_COUNT = 8;

export function normalizeHours(value) {
    if (!Array.isArray(value) && (value === null || typeof value !== "object")) {
        return Array(HOUR_COUNT).fill(0);
    }

    return Array.from({ length: HOUR_COUNT }, (_, index) => {
        const hour = Number(value[index]);
        return Number.isFinite(hour) ? hour : 0;
    });
}
