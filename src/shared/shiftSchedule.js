const DAY_MS = 24 * 60 * 60 * 1000;
const ANCHOR_DATE = Date.UTC(2026, 9, 17);
const CYCLE_DAYS = 8;

const REST_START_DAYS = {
    A: -1,
    B: 1,
    C: 3,
    D: 5,
};

const SLOTS = [
    { id: "morning", start: 7, end: 15, label: "07:00–15:00" },
    { id: "afternoon", start: 15, end: 23, label: "15:00–23:00" },
    { id: "night", start: 23, end: 7, label: "23:00–07:00" },
];

function positiveModulo(value, divisor) {
    return ((value % divisor) + divisor) % divisor;
}

function dayIndexForDate(date) {
    const midnight = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.floor((midnight - ANCHOR_DATE) / DAY_MS);
}

function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function transitionForDay(dayIndex) {
    const restingTeam = Object.keys(REST_START_DAYS).find(
        (team) => positiveModulo(dayIndex - REST_START_DAYS[team], CYCLE_DAYS) === 0
    );
    if (!restingTeam) return null;

    const returningTeam = Object.keys(REST_START_DAYS).find(
        (team) => positiveModulo(dayIndex - REST_START_DAYS[team] - 2, CYCLE_DAYS) === 0
    );
    if (!returningTeam) {
        throw new Error(`No returning shift team found for schedule day ${dayIndex}.`);
    }

    return { restingTeam, returningTeam };
}

function applyTransition(assignments, dayIndex) {
    const transition = transitionForDay(dayIndex);
    if (!transition) return;

    const slot = Object.keys(assignments).find(
        (slotId) => assignments[slotId] === transition.restingTeam
    );
    if (!slot) {
        throw new Error(`Resting shift ${transition.restingTeam} is not assigned to a time slot.`);
    }

    assignments[slot] = transition.returningTeam;
}

function reverseTransition(assignments, dayIndex) {
    const transition = transitionForDay(dayIndex);
    if (!transition) return;

    const slot = Object.keys(assignments).find(
        (slotId) => assignments[slotId] === transition.returningTeam
    );
    if (!slot) {
        throw new Error(`Returning shift ${transition.returningTeam} is not assigned to a time slot.`);
    }

    assignments[slot] = transition.restingTeam;
}

export function getShiftAssignments(date) {
    const targetDay = dayIndexForDate(date);
    const assignments = {
        morning: "D",
        afternoon: "C",
        night: "B",
    };

    if (targetDay > 0) {
        for (let day = 1; day <= targetDay; day += 1) {
            applyTransition(assignments, day);
        }
    } else {
        for (let day = 0; day > targetDay; day -= 1) {
            reverseTransition(assignments, day);
        }
    }

    return assignments;
}

function getShiftWorkDay(team, date) {
    const daysSinceRestStarted = positiveModulo(
        dayIndexForDate(date) - REST_START_DAYS[team],
        CYCLE_DAYS
    );
    return positiveModulo(daysSinceRestStarted - 2, CYCLE_DAYS) + 1;
}

export function getActiveShift(date) {
    const hour = date.getHours();
    const shiftDate = new Date(date);
    let slot;

    if (hour >= 7 && hour < 15) {
        slot = SLOTS[0];
    } else if (hour >= 15 && hour < 23) {
        slot = SLOTS[1];
    } else {
        slot = SLOTS[2];
        if (hour < 7) shiftDate.setDate(shiftDate.getDate() - 1);
    }

    const shift = getShiftAssignments(shiftDate)[slot.id];
    return {
        shift,
        slot: slot.label,
        date: formatDate(shiftDate),
        workDay: getShiftWorkDay(shift, shiftDate),
    };
}

export function getShiftTeamWarning(assignedTeam, activeShift) {
    if (!["A", "B", "C", "D"].includes(assignedTeam)) {
        return "No shift team is assigned to your account. Please check with an administrator. You can still continue.";
    }
    if (assignedTeam !== activeShift.shift) {
        return `Your assigned team is ${assignedTeam}, but Team ${activeShift.shift} is currently working (${activeShift.slot}). You can still continue.`;
    }
    return "";
}
