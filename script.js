const CALENDAR_TYPES = [
    { type: "departure", name: "Departure" },
    { type: "lesson", name: "Lesson" },
    { type: "walk", name: "Walk" }
];

const EVENT_DISPLAY_NAMES = {
    departure: "DEPARTURE",
    preparation: "PREPARATION",
    "walk-1": "WALK 1",
    "walk-2": "WALK 2",
    "walk-3": "WALK 3",
    "lesson-zumba": "ZUMBA",
    "lesson-dark-box": "DARK BOX",
    "lesson-fight-do": "FIGHT DO",
    "lesson-group-centergy": "GROUP CENTERGY",
    "lesson-megadanz": "MEGADANZ"
};

const EVENT_EMOJI_BY_TYPE = {
    departure: "🚗",
    walk: "🚶"
};

const LESSON_EMOJIS = {
    "lesson-zumba": "💃",
    "lesson-dark-box": "🥊",
    "lesson-fight-do": "🥊",
    "lesson-group-centergy": "🧘",
    "lesson-megadanz": "💃"
};

const MISSION_DISPLAY_NAMES = {
    "walk-1": "1st WALK",
    "walk-2": "2nd WALK",
    "walk-3": "3rd WALK"
};

const WEEKDAY_ABBREVIATIONS = ["Sun.", "Mon.", "Tue.", "Wed.", "Thu.", "Fri.", "Sat."];
const SPECIAL_SCHEDULE_STORAGE_KEY = "project-salus-special-schedules";
const MISSION_HISTORY_STORAGE_KEY = "project-salus-mission-history";
const MISSION_HISTORY_VERSION = 1;

function isValidTime(value) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function loadSpecialSchedules() {
    try {
        const storedValue = window.localStorage.getItem(SPECIAL_SCHEDULE_STORAGE_KEY);
        if (storedValue === null) {
            return { schedules: {}, status: "empty", error: "" };
        }

        const parsed = JSON.parse(storedValue);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return {
                schedules: {},
                status: "error",
                error: "Saved special schedules could not be read. Editing is disabled to protect existing data."
            };
        }

        let hasInvalidSchedule = false;
        const schedules = Object.fromEntries(Object.entries(parsed).flatMap(([date, schedule]) => {
            if (!parseLocalDate(date) || !schedule || typeof schedule !== "object" ||
                Array.isArray(schedule)) {
                hasInvalidSchedule = true;
                return [];
            }

            const departureField = schedule.departure;
            const departureTime = schedule.departure?.time ?? schedule.departureTime;
            if ((departureField !== undefined && departureField !== null &&
                (!departureField || typeof departureField !== "object" ||
                    Array.isArray(departureField) || !isValidTime(departureField.time))) ||
                (departureTime !== undefined && departureTime !== null && !isValidTime(departureTime))) {
                hasInvalidSchedule = true;
                return [];
            }
            if (schedule.lessons !== undefined && !Array.isArray(schedule.lessons)) {
                hasInvalidSchedule = true;
                return [];
            }
            const departure = isValidTime(departureTime)
                ? { time: departureTime }
                : null;
            const sourceLessons = schedule.lessons || [];
            const validLessons = sourceLessons.every(lesson =>
                lesson &&
                typeof lesson.name === "string" &&
                lesson.name.trim() &&
                isValidTime(lesson.start) &&
                isValidTime(lesson.end) &&
                lesson.start < lesson.end &&
                (lesson.emoji === undefined || typeof lesson.emoji === "string")
            );
            if (!validLessons) {
                hasInvalidSchedule = true;
                return [];
            }
            const lessons = sourceLessons.map(lesson => ({
                name: lesson.name.trim(),
                start: lesson.start,
                end: lesson.end,
                emoji: lesson.emoji || ""
            }));

            return [[date, { date, departure, lessons }]];
        }));
        if (hasInvalidSchedule) {
            return {
                schedules: {},
                status: "error",
                error: "Some saved special schedules are invalid. Editing is disabled to protect existing data."
            };
        }

        return { schedules, status: "loaded", error: "" };
    } catch {
        return {
            schedules: {},
            status: "error",
            error: "Saved special schedules could not be read. Editing is disabled to protect existing data."
        };
    }
}

function getSpecialScheduleDateOverrides(schedules) {
    return Object.entries(schedules)
        .sort(([firstDate], [secondDate]) => firstDate.localeCompare(secondDate))
        .map(([date, schedule]) => {
            const departure = schedule.departure || (schedule.departureTime
                ? { time: schedule.departureTime }
                : null);
            return {
            date,
            reopenClosedDay: true,
            events: [
                ...(departure ? [{
                    id: "special-departure",
                    type: "departure",
                    label: "DEPARTURE",
                    start: departure.time,
                    emoji: "🚗",
                    specialSchedule: true
                }] : []),
                ...schedule.lessons.map((lesson, index) => ({
                    id: `special-lesson-${index + 1}`,
                    type: "lesson",
                    label: lesson.name,
                    start: lesson.start,
                    end: lesson.end,
                    emoji: lesson.emoji,
                    specialSchedule: true
                }))
            ]
        };
        });
}

function getEventDisplayName(event) {
    if (event.specialSchedule) {
        return event.label;
    }
    return EVENT_DISPLAY_NAMES[event.id] || event.label;
}

function getICSEventDisplayName(event) {
    if (!event.specialSchedule) {
        return getEventDisplayName(event);
    }
    if (event.type === "departure") {
        return `🚗 ${getEventDisplayName(event)}`;
    }
    return event.type === "lesson" && event.emoji
        ? `${event.emoji} ${getEventDisplayName(event)}`
        : getEventDisplayName(event);
}

function getMissionDisplayName(event) {
    return MISSION_DISPLAY_NAMES[event.id] || getEventDisplayName(event);
}

function getEventEmoji(event) {
    if (event.specialSchedule) {
        return event.type === "departure" ? "🚗" : event.emoji || "";
    }
    return LESSON_EMOJIS[event.id] || EVENT_EMOJI_BY_TYPE[event.type] || "";
}

function getEventDescription(event) {
    const incline = event.incline?.match(/[\d.]+%/)?.[0];
    return event.speed && incline
        ? `${event.speed} · ${incline}`
        : "";
}

function escapeICSText(value) {
    return value
        .replaceAll("\\", "\\\\")
        .replaceAll(";", "\\;")
        .replaceAll(",", "\\,")
        .replace(/\r\n|\r|\n/g, "\\n");
}

function foldICSLine(line) {
    const encoder = new TextEncoder();
    const foldedLines = [];
    let currentLine = "";
    let currentLength = 0;

    for (const character of line) {
        const characterLength = encoder.encode(character).length;
        if (currentLength + characterLength > 75) {
            foldedLines.push(currentLine);
            currentLine = ` ${character}`;
            currentLength = characterLength + 1;
        } else {
            currentLine += character;
            currentLength += characterLength;
        }
    }

    foldedLines.push(currentLine);
    return foldedLines.join("\r\n");
}

function formatICSDateTime(dateKey, time) {
    return `${dateKey.replaceAll("-", "")}T${time.replace(":", "")}00`;
}

function createICS(events) {
    const dtstamp = new Date().toISOString()
        .replaceAll("-", "")
        .replaceAll(":", "")
        .replace(/\.\d{3}Z$/, "Z");
    const lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//PROJECT SALUS//Mission Control//EN",
        "CALSCALE:GREGORIAN",
        "BEGIN:VTIMEZONE",
        "TZID:Asia/Tokyo",
        "X-LIC-LOCATION:Asia/Tokyo",
        "BEGIN:STANDARD",
        "DTSTART:19700101T000000",
        "TZOFFSETFROM:+0900",
        "TZOFFSETTO:+0900",
        "TZNAME:JST",
        "END:STANDARD",
        "END:VTIMEZONE"
    ];

    events.forEach(({ dateKey, event }) => {
        lines.push(
            "BEGIN:VEVENT",
            `UID:${escapeICSText(`${dateKey}-${event.id}@project-salus`)}`,
            `DTSTAMP:${dtstamp}`,
            `DTSTART;TZID=Asia/Tokyo:${formatICSDateTime(dateKey, event.start)}`
        );
        if (event.end) {
            lines.push(`DTEND;TZID=Asia/Tokyo:${formatICSDateTime(dateKey, event.end)}`);
        }
        lines.push(
            `SUMMARY:${escapeICSText(getICSEventDisplayName(event))}`
        );

        const description = event.type === "walk" ? getEventDescription(event) : "";
        if (description) {
            lines.push(`DESCRIPTION:${escapeICSText(description)}`);
        }
        lines.push("END:VEVENT");
    });

    lines.push("END:VCALENDAR");
    return `${lines.map(foldICSLine).join("\r\n")}\r\n`;
}

function parseLocalDate(dateValue) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
    if (!match) {
        return null;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day
        ? date
        : null;
}

function formatScheduleEvent(event) {
    const time = event.end && event.type !== "departure"
        ? `${event.start}–${event.end}`
        : event.start;
    const label = getMissionDisplayName(event);
    const details = getEventDescription(event);

    return { time, label, details };
}

function renderSchedule(events, scheduleElement, emptyMessage, attendanceDateKey = "") {
    scheduleElement.replaceChildren();

    if (events.length === 0) {
        const item = document.createElement("li");
        item.textContent = emptyMessage;
        scheduleElement.append(item);
        return;
    }

    events.forEach(event => {
        const item = document.createElement("li");
        const main = document.createElement("span");
        main.className = "mission-item-main";
        const { time, label, details } = formatScheduleEvent(event);
        const timeElement = document.createElement("span");
        timeElement.className = "mission-item-time";
        timeElement.textContent = time;
        const emojiElement = document.createElement("span");
        emojiElement.className = "mission-item-emoji";
        emojiElement.setAttribute("aria-hidden", "true");
        emojiElement.textContent = getEventEmoji(event);
        const labelElement = document.createElement(
            attendanceDateKey && event.type === "lesson" ? "label" : "span"
        );
        labelElement.className = event.type === "lesson"
            ? "mission-item-label mission-item-label--lesson"
            : "mission-item-label";
        labelElement.textContent = label;
        if (attendanceDateKey && event.type === "lesson") {
            const labelText = document.createElement("span");
            labelText.textContent = label;
            labelElement.textContent = "";
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = isLessonAttended(missionHistory[attendanceDateKey], event);
            checkbox.setAttribute("aria-label", `Mark ${label} as attended`);
            checkbox.addEventListener("change", () => {
                const status = document.getElementById("todayAttendanceStatus");
                const saved = saveScheduledLessonAttendance(
                    attendanceDateKey,
                    event.id,
                    checkbox.checked,
                    false
                );
                if (status) {
                    status.textContent = saved
                        ? "Attendance saved."
                        : "Could not save attendance in this browser.";
                }
            });
            labelElement.append(checkbox, labelText);
        }
        main.append(timeElement, emojiElement, labelElement);
        item.append(main);
        if (details) {
            const detailsElement = document.createElement("span");
            detailsElement.className = "mission-item-details";
            detailsElement.textContent = details;
            item.append(detailsElement);
        }
        scheduleElement.append(item);
    });
}

let todayScheduleSignature = "";

function getTodayScheduleSignature(dateKey, events) {
    return JSON.stringify([
        dateKey,
        events.map(event => [
            event.id,
            event.type,
            event.label,
            event.start,
            event.end,
            event.type === "lesson" && isLessonAttended(missionHistory[dateKey], event)
        ])
    ]);
}

function findNextGymDay(now, getScheduleForDate) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    for (let dayOffset = 1; dayOffset <= 366; dayOffset += 1) {
        date.setDate(date.getDate() + 1);
        const events = getScheduleForDate(date);
        if (events.length > 0) {
            return {
                date: new Date(date),
                events: events.filter(event => event.id !== "preparation")
            };
        }
    }

    return null;
}

function updateDashboard(now) {
    const scheduleElement = document.getElementById("todaySchedule");
    const nextGymDayDateElement = document.getElementById("nextGymDayDate");
    const nextGymDayScheduleElement = document.getElementById("nextGymDaySchedule");
    const upcomingGymDayCard = document.getElementById("upcomingGymDayCard");
    const upcomingGymDayDateElement = document.getElementById("upcomingGymDayDate");
    const upcomingGymDayScheduleElement = document.getElementById("upcomingGymDaySchedule");
    const nextMissionElement = document.getElementById("nextMission");
    const nextMissionEmojiElement = document.getElementById("nextMissionEmoji");
    const nextMissionNameElement = document.getElementById("nextMissionName");

    if (
        !scheduleElement ||
        !nextGymDayDateElement ||
        !nextGymDayScheduleElement ||
        !upcomingGymDayCard ||
        !upcomingGymDayDateElement ||
        !upcomingGymDayScheduleElement ||
        !nextMissionElement ||
        !nextMissionEmojiElement ||
        !nextMissionNameElement ||
        !window.SALUS_SCHEDULE
    ) {
        return;
    }

    const dateKey = dateToKey(now);
    const events = window.SALUS_SCHEDULE.getScheduleForDate(now)
        .filter(event => event.id !== "preparation");
    const scheduleSignature = getTodayScheduleSignature(dateKey, events);
    if (scheduleSignature !== todayScheduleSignature) {
        renderSchedule(events, scheduleElement, "No missions scheduled today.", dateKey);
        todayScheduleSignature = scheduleSignature;
    }

    const nextGymDay = findNextGymDay(
        now,
        window.SALUS_SCHEDULE.getScheduleForDate
    );
    if (nextGymDay) {
        nextGymDayDateElement.textContent = nextGymDay.date.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric"
        });
        renderSchedule(
            nextGymDay.events,
            nextGymDayScheduleElement,
            "No missions scheduled."
        );
        const upcomingGymDay = findNextGymDay(
            nextGymDay.date,
            window.SALUS_SCHEDULE.getScheduleForDate
        );
        upcomingGymDayCard.hidden = !upcomingGymDay;
        if (upcomingGymDay) {
            upcomingGymDayDateElement.textContent = upcomingGymDay.date.toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric"
            });
            renderSchedule(
                upcomingGymDay.events,
                upcomingGymDayScheduleElement,
                "No missions scheduled."
            );
        } else {
            upcomingGymDayDateElement.textContent = "";
            upcomingGymDayScheduleElement.replaceChildren();
        }
    } else {
        nextGymDayDateElement.textContent = "No upcoming gym day found.";
        nextGymDayScheduleElement.replaceChildren();
        upcomingGymDayCard.hidden = true;
        upcomingGymDayDateElement.textContent = "";
        upcomingGymDayScheduleElement.replaceChildren();
    }

    const nextMission = window.SALUS_SCHEDULE.findNextDeparture(now, 14);
    if (nextMission) {
        const event = nextMission.event || window.SALUS_SCHEDULE.getScheduleForDate(nextMission.date)
            .find(item => item.type === "departure") ||
            { id: "departure", type: "departure", label: "DEPARTURE" };
        nextMissionEmojiElement.textContent = getEventEmoji(event);
        nextMissionNameElement.textContent = getMissionDisplayName(event);
        nextMissionElement.textContent =
            `${WEEKDAY_ABBREVIATIONS[nextMission.date.getDay()]} ${nextMission.time}`;
    } else {
        nextMissionEmojiElement.textContent = "";
        nextMissionNameElement.textContent = "";
        nextMissionElement.textContent = "No gym missions in the next 14 days.";
    }
}

const button = document.getElementById("calendarButton");
const createScheduleEngine = window.SALUS_SCHEDULE.createScheduleEngine;
const defaultDateOverrides = window.SALUS_SCHEDULE.defaultDateOverrides;
const loadedSpecialSchedules = loadSpecialSchedules();
let specialSchedules = loadedSpecialSchedules.schedules;
let specialSchedulesLoadState = loadedSpecialSchedules.status;

function applySpecialSchedules() {
    const dateOverridesByDate = new Map(defaultDateOverrides.map(override => [
        override.date,
        override
    ]));
    getSpecialScheduleDateOverrides(specialSchedules).forEach(override => {
        dateOverridesByDate.set(override.date, override);
    });
    window.SALUS_SCHEDULE = createScheduleEngine({
        dateOverrides: [...dateOverridesByDate.values()]
    });
}

function formatSpecialDate(dateKey) {
    const date = parseLocalDate(dateKey);
    return date
        ? date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
        : dateKey;
}

function cloneSpecialSchedule(date, schedule = {}) {
    const departureTime = schedule.departure?.time ?? schedule.departureTime;
    return {
        date,
        departure: isValidTime(departureTime)
            ? { time: departureTime }
            : null,
        lessons: Array.isArray(schedule.lessons)
            ? schedule.lessons.map(lesson => ({
                name: lesson.name || "",
                start: lesson.start || "",
                end: lesson.end || "",
                emoji: lesson.emoji || ""
            }))
            : []
    };
}

function persistSpecialSchedules(schedules) {
    if (specialSchedulesLoadState === "error") {
        return false;
    }
    try {
        window.localStorage.setItem(SPECIAL_SCHEDULE_STORAGE_KEY, JSON.stringify(schedules));
        specialSchedulesLoadState = "loaded";
        return true;
    } catch {
        return false;
    }
}

function createSpecialLessonRow(container, lesson = {}, onChange = () => {}) {
    const row = document.createElement("div");
    row.className = "special-lesson-row";

    const identityFields = document.createElement("div");
    identityFields.className = "special-lesson-identity";
    const timeFields = document.createElement("div");
    timeFields.className = "special-lesson-times";

    [
        { name: "Emoji", type: "text", className: "lesson-emoji", value: lesson.emoji || "", placeholder: "Optional", required: false, group: identityFields },
        { name: "Lesson name", type: "text", className: "lesson-name", value: lesson.name || "", placeholder: "e.g. ZUMBA", required: true, group: identityFields },
        { name: "Start", type: "time", className: "lesson-start", value: lesson.start || "", required: true, group: timeFields },
        { name: "End", type: "time", className: "lesson-end", value: lesson.end || "", required: true, group: timeFields }
    ].forEach(({ name, type, className, value, placeholder, required, group }) => {
        const label = document.createElement("label");
        label.className = "special-lesson-field";
        label.append(document.createTextNode(name));
        const input = document.createElement("input");
        input.type = type;
        input.className = className;
        input.required = required;
        input.value = value;
        if (placeholder) {
            input.placeholder = placeholder;
        }
        if (className === "lesson-name") {
            input.maxLength = 80;
        }
        if (className === "lesson-emoji") {
            input.setAttribute("inputmode", "text");
        }
        input.addEventListener("input", onChange);
        if (type === "time") {
            const inputWrapper = document.createElement("div");
            inputWrapper.className = "special-time-input-wrapper";
            inputWrapper.append(input);
            label.append(inputWrapper);
        } else {
            label.append(input);
        }
        group.append(label);
    });
    row.append(identityFields, timeFields);

    const removeButton = document.createElement("button");
    removeButton.className = "remove-lesson-button";
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => {
        row.remove();
        onChange();
    });
    row.append(removeButton);
    container.append(row);
}

function readSpecialDateSection(section) {
    const departureTime = section.querySelector(".special-departure-time").value;
    return {
        date: section.dataset.date,
        departure: departureTime ? { time: departureTime } : null,
        lessons: [...section.querySelectorAll(".special-lesson-row")].map(row => ({
            name: row.querySelector(".lesson-name").value.trim(),
            start: row.querySelector(".lesson-start").value,
            end: row.querySelector(".lesson-end").value,
            emoji: row.querySelector(".lesson-emoji").value
        }))
    };
}

function createSpecialDaySection(date, schedule, onChange) {
    const section = document.createElement("section");
    section.className = "special-day-section";
    section.dataset.date = date;

    const heading = document.createElement("h4");
    heading.textContent = formatSpecialDate(date);
    section.append(heading);

    const departureFields = document.createElement("div");
    departureFields.className = "special-departure-fields";
    const departureLabel = document.createElement("label");
    departureLabel.className = "special-day-field";
    departureLabel.append(document.createTextNode("Departure time (optional)"));
    const departureInput = document.createElement("input");
    departureInput.type = "time";
    departureInput.className = "special-departure-time";
    departureInput.value = schedule.departure?.time || "";
    departureInput.addEventListener("input", onChange);
    const departureInputWrapper = document.createElement("div");
    departureInputWrapper.className = "special-time-input-wrapper";
    departureInputWrapper.append(departureInput);
    departureLabel.append(departureInputWrapper);
    departureFields.append(departureLabel);
    section.append(departureFields);

    const lessonHeading = document.createElement("h5");
    lessonHeading.textContent = "Lessons";
    section.append(lessonHeading);
    const lessons = document.createElement("div");
    lessons.className = "special-lesson-fields";
    schedule.lessons.forEach(lesson => createSpecialLessonRow(lessons, lesson, onChange));
    section.append(lessons);

    const addButton = document.createElement("button");
    addButton.className = "text-button";
    addButton.type = "button";
    addButton.textContent = "+ Add lesson";
    addButton.addEventListener("click", () => {
        createSpecialLessonRow(lessons, {}, onChange);
        onChange();
    });
    section.append(addButton);
    return section;
}

function renderSpecialScheduleList() {
    const list = document.getElementById("specialScheduleList");
    const emptyMessage = document.getElementById("specialScheduleEmpty");
    if (!list || !emptyMessage) {
        return;
    }

    const dates = Object.keys(specialSchedules).sort();
    list.replaceChildren();
    emptyMessage.hidden = dates.length > 0;

    dates.forEach(date => {
        const schedule = specialSchedules[date];
        const item = document.createElement("li");
        const summary = document.createElement("span");
        const lessonSummary = schedule.lessons.map(lesson => lesson.name).join(", ");
        const departureTime = schedule.departure?.time || schedule.departureTime;
        summary.textContent = `${formatSpecialDate(date)} · ${departureTime || "No departure"}` +
            (lessonSummary ? ` · ${lessonSummary}` : " · No lessons");

        const removeButton = document.createElement("button");
        removeButton.className = "remove-special-day-button";
        removeButton.type = "button";
        removeButton.textContent = "Remove";
        removeButton.setAttribute("aria-label", `Remove special schedule for ${formatSpecialDate(date)}`);
        removeButton.addEventListener("click", () => {
            const updatedSchedules = { ...specialSchedules };
            delete updatedSchedules[date];
            const status = document.getElementById("specialScheduleStatus");
            if (!persistSpecialSchedules(updatedSchedules)) {
                if (status) {
                    status.textContent = "Could not save changes in this browser.";
                }
                return;
            }

            specialSchedules = updatedSchedules;
            applySpecialSchedules();
            renderSpecialScheduleList();
            updateMissionDisplay();
            renderMissionHistoryDate();
            renderMissionActivityMap();
            if (status) {
                status.textContent = `Removed ${formatSpecialDate(date)}.`;
            }
        });

        item.append(summary, removeButton);
        list.append(item);
    });
}

function initializeSpecialScheduleManagement() {
    const dialog = document.getElementById("specialScheduleDialog");
    const form = document.getElementById("specialScheduleForm");
    const dateSchedules = document.getElementById("specialDateSchedules");
    const message = document.getElementById("specialScheduleMessage");
    const openButton = document.getElementById("specialScheduleButton");
    if (!dialog || !form || !dateSchedules || !message || !openButton) {
        return;
    }

    if (specialSchedulesLoadState === "error") {
        openButton.disabled = true;
        const status = document.getElementById("specialScheduleStatus");
        if (status) {
            status.textContent = loadedSpecialSchedules.error;
        }
    }

    const startDateInput = document.getElementById("specialStartDate");
    const endDateInput = document.getElementById("specialEndDate");
    const status = document.getElementById("specialScheduleStatus");
    let draftSchedules = {};

    function syncVisibleSchedules() {
        dateSchedules.querySelectorAll(".special-day-section").forEach(section => {
            const schedule = readSpecialDateSection(section);
            draftSchedules[schedule.date] = schedule;
        });
    }

    function getSelectedDateKeys() {
        if (!startDateInput.value && !endDateInput.value) {
            return { dates: [], error: "" };
        }
        const startDate = parseLocalDate(startDateInput.value);
        const endDate = parseLocalDate(endDateInput.value);
        if (!startDate || !endDate) {
            return { dates: null, error: "Enter a valid start and end date." };
        }
        if (startDate > endDate) {
            return { dates: null, error: "End date must be on or after the start date." };
        }

        const dates = [];
        const date = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
        while (date <= endDate) {
            dates.push([
                date.getFullYear(),
                String(date.getMonth() + 1).padStart(2, "0"),
                String(date.getDate()).padStart(2, "0")
            ].join("-"));
            date.setDate(date.getDate() + 1);
        }
        return { dates, error: "" };
    }

    function renderSelectedDateRows() {
        syncVisibleSchedules();
        const { dates, error } = getSelectedDateKeys();
        if (error) {
            message.textContent = error;
            return;
        }
        message.textContent = "";
        dateSchedules.replaceChildren();
        dates.forEach(date => {
            const schedule = draftSchedules[date] || cloneSpecialSchedule(date, specialSchedules[date]);
            draftSchedules[date] = schedule;
            const section = createSpecialDaySection(date, schedule, () => {
                const updated = readSpecialDateSection(section);
                draftSchedules[date] = updated;
            });
            dateSchedules.append(section);
        });
    }

    openButton.addEventListener("click", () => {
        if (specialSchedulesLoadState === "error") {
            return;
        }
        form.reset();
        dateSchedules.replaceChildren();
        draftSchedules = Object.fromEntries(Object.entries(specialSchedules).map(([date, schedule]) => [
            date,
            cloneSpecialSchedule(date, schedule)
        ]));
        message.textContent = "";
        startDateInput.value = document.getElementById("startDate").value;
        endDateInput.value = document.getElementById("endDate").value;
        renderSelectedDateRows();
        dialog.showModal();
    });
    document.getElementById("closeSpecialScheduleButton").addEventListener("click", () => dialog.close());
    document.getElementById("cancelSpecialScheduleButton").addEventListener("click", () => dialog.close());
    startDateInput.addEventListener("change", renderSelectedDateRows);
    endDateInput.addEventListener("change", renderSelectedDateRows);

    form.addEventListener("submit", event => {
        event.preventDefault();
        if (specialSchedulesLoadState === "error") {
            message.textContent = loadedSpecialSchedules.error;
            return;
        }
        syncVisibleSchedules();
        const { dates, error } = getSelectedDateKeys();
        if (error || dates.length === 0) {
            message.textContent = error || "Select a date range.";
            return;
        }

        const updatedSchedules = { ...specialSchedules };
        for (const date of dates) {
            const schedule = draftSchedules[date] || cloneSpecialSchedule(date);
            if (schedule.departure && !isValidTime(schedule.departure.time)) {
                message.textContent = `Enter a valid departure time for ${formatSpecialDate(date)}.`;
                return;
            }
            if (schedule.lessons.some(lesson =>
                !lesson.name || lesson.name.length > 80 ||
                !isValidTime(lesson.start) || !isValidTime(lesson.end) ||
                lesson.start >= lesson.end
            )) {
                message.textContent = `Complete each lesson name and time range for ${formatSpecialDate(date)}.`;
                return;
            }
            updatedSchedules[date] = {
                date,
                departure: schedule.departure?.time
                    ? { time: schedule.departure.time }
                    : null,
                lessons: schedule.lessons.map(lesson => ({ ...lesson }))
            };
        }

        if (!persistSpecialSchedules(updatedSchedules)) {
            message.textContent = "Could not save changes in this browser.";
            return;
        }

        specialSchedules = updatedSchedules;
        applySpecialSchedules();
        renderSpecialScheduleList();
        updateMissionDisplay();
        renderMissionHistoryDate();
        renderMissionActivityMap();
        if (status) {
            status.textContent = "Special schedules saved.";
        }
        dialog.close();
    });

    renderSpecialScheduleList();
}

function updateMissionDisplay() {
    const now = new Date();
    updateDashboard(now);
}

function dateToKey(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

function isValidMissionHistoryRecord(date, record) {
    return parseLocalDate(date) &&
        record &&
        typeof record === "object" &&
        record.date === date &&
        (record.gymVisited === undefined || typeof record.gymVisited === "boolean") &&
        typeof record.plannedGym === "boolean" &&
        typeof record.updatedAt === "string" &&
        Number.isFinite(Date.parse(record.updatedAt)) &&
        Array.isArray(record.lessons);
}

function loadMissionHistory() {
    try {
        const storedValue = window.localStorage.getItem(MISSION_HISTORY_STORAGE_KEY);
        if (storedValue === null) {
            return { records: {}, status: "empty", error: "" };
        }

        const parsed = JSON.parse(storedValue);
        if (!parsed || parsed.version !== MISSION_HISTORY_VERSION ||
            !parsed.records || typeof parsed.records !== "object" ||
            Array.isArray(parsed.records)) {
            return {
                records: {},
                status: "error",
                error: "Saved mission history could not be read. Editing is disabled to protect existing data."
            };
        }

        let hasInvalidRecord = false;
        const records = {};
        Object.entries(parsed.records).forEach(([date, record]) => {
            if (!isValidMissionHistoryRecord(date, record)) {
                hasInvalidRecord = true;
                return;
            }
            const lessons = record.lessons.filter(lesson =>
                lesson &&
                typeof lesson.id === "string" &&
                typeof lesson.name === "string" &&
                typeof lesson.attended === "boolean"
            ).map(lesson => ({
                id: lesson.id,
                name: lesson.name,
                attended: lesson.attended
            }));
            if (lessons.length !== record.lessons.length) {
                hasInvalidRecord = true;
            }
            records[date] = {
                ...record,
                date,
                plannedGym: record.plannedGym,
                lessons,
                updatedAt: record.updatedAt
            };
        });
        return hasInvalidRecord
            ? {
                records: {},
                status: "error",
                error: "Some saved mission history entries are invalid. Editing is disabled to protect existing data."
            }
            : { records, status: "loaded", error: "" };
    } catch {
        return {
            records: {},
            status: "error",
            error: "Saved mission history could not be read. Editing is disabled to protect existing data."
        };
    }
}

let missionHistory = {};
let missionHistoryLoadState = "unloaded";

function getAttendedLessonCount(record) {
    const attendedLessons = (record?.lessons || []).filter(lesson => lesson.attended);
    const uniqueLessons = new Set(attendedLessons.map(lesson =>
        lesson.id || lesson.name.trim().toLocaleLowerCase()
    ));
    return uniqueLessons.size;
}

function isLessonAttended(record, event) {
    const byId = record?.lessons?.find(lesson => lesson.id === event.id);
    if (byId) {
        return byId.attended;
    }
    return record?.lessons?.some(lesson =>
        lesson.name.trim().toLocaleLowerCase() === getMissionDisplayName(event).trim().toLocaleLowerCase() &&
        lesson.attended
    ) || false;
}

function persistMissionHistory(records) {
    if (missionHistoryLoadState === "error" || missionHistoryLoadState === "unloaded") {
        return false;
    }
    try {
        window.localStorage.setItem(MISSION_HISTORY_STORAGE_KEY, JSON.stringify({
            version: MISSION_HISTORY_VERSION,
            records
        }));
        missionHistoryLoadState = "loaded";
        return true;
    } catch {
        return false;
    }
}

function saveMissionAttendance(dateKey, scheduledEvents, lessons, refreshDashboard = true) {
    const existingRecord = missionHistory[dateKey];
    const updatedRecords = {
        ...missionHistory,
        [dateKey]: {
            date: dateKey,
            plannedGym: existingRecord
                ? existingRecord.plannedGym
                : hasPlannedGymSchedule(scheduledEvents),
            lessons,
            updatedAt: new Date().toISOString()
        }
    };
    if (!persistMissionHistory(updatedRecords)) {
        return false;
    }

    missionHistory = updatedRecords;
    renderMissionHistoryList();
    renderMissionActivityMap();
    const { dateInput } = getHistoryElements();
    if (dateInput?.value === dateKey) {
        renderMissionHistoryDate();
    }
    if (refreshDashboard) {
        updateMissionDisplay();
    } else {
        const now = new Date();
        if (dateToKey(now) === dateKey) {
            const todayEvents = window.SALUS_SCHEDULE.getScheduleForDate(now)
                .filter(event => event.id !== "preparation");
            todayScheduleSignature = getTodayScheduleSignature(dateKey, todayEvents);
        }
    }
    return true;
}

function saveScheduledLessonAttendance(dateKey, lessonId, attended, refreshDashboard = true) {
    const date = parseLocalDate(dateKey);
    if (!date) {
        return false;
    }

    const scheduledEvents = getMissionHistoryScheduleForDate(date);
    const existingRecord = missionHistory[dateKey];
    const lessons = scheduledEvents
        .filter(event => event.type === "lesson")
        .map(event => ({
            id: event.id,
            name: getMissionDisplayName(event),
            attended: event.id === lessonId
                ? attended
                : isLessonAttended(existingRecord, event)
        }));
    return saveMissionAttendance(dateKey, scheduledEvents, lessons, refreshDashboard);
}

function hasPlannedGymSchedule(events) {
    return events.some(event =>
        event.type === "departure" ||
        event.type === "lesson" ||
        event.type === "walk"
    );
}

function getMissionHistoryScheduleForDate(date) {
    return window.SALUS_SCHEDULE.getScheduleForDate(date, {
        ignoreDefaultHolidayClosure: true
    });
}

function getHistoryElements() {
    return {
        dateInput: document.getElementById("historyDate"),
        scheduleSummary: document.getElementById("historyScheduleSummary"),
        lessonList: document.getElementById("historyLessonList"),
        saveButton: document.getElementById("saveHistoryButton"),
        deleteButton: document.getElementById("deleteHistoryButton"),
        status: document.getElementById("historyStatus"),
        recordsList: document.getElementById("missionHistoryList"),
        emptyMessage: document.getElementById("missionHistoryEmpty")
    };
}

function renderMissionHistoryDate() {
    const {
        dateInput,
        scheduleSummary,
        lessonList,
        deleteButton
    } = getHistoryElements();
    if (!dateInput || !scheduleSummary || !lessonList || !deleteButton) {
        return;
    }

    const dateKey = dateInput.value;
    const date = parseLocalDate(dateKey);
    lessonList.replaceChildren();
    if (!date) {
        scheduleSummary.textContent = "Select a valid date to record attendance.";
        deleteButton.hidden = true;
        return;
    }

    const record = missionHistory[dateKey];
    const scheduledEvents = getMissionHistoryScheduleForDate(date);
    const plannedGym = record ? record.plannedGym : hasPlannedGymSchedule(scheduledEvents);
    const lessons = record
        ? record.lessons
        : scheduledEvents
            .filter(event => event.type === "lesson")
            .map(event => ({
                id: event.id,
                name: getMissionDisplayName(event),
                attended: false
            }));
    scheduleSummary.textContent = record
        ? `${plannedGym ? "Scheduled gym day" : "No gym schedule"} · Saved record from ${new Date(record.updatedAt).toLocaleDateString("en-US")}`
        : plannedGym
            ? "Scheduled gym day · Select the lessons you attended."
            : "No gym schedule for this date.";
    deleteButton.hidden = !record;

    if (lessons.length === 0) {
        const empty = document.createElement("p");
        empty.className = "history-lesson-empty";
        empty.textContent = "No lessons scheduled for this date.";
        lessonList.append(empty);
        return;
    }

    lessons.forEach(lesson => {
        const row = document.createElement("label");
        row.className = "history-lesson-check";
        row.dataset.lessonId = lesson.id;
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = lesson.attended;
        const name = document.createElement("span");
        name.textContent = lesson.name;
        row.attendanceCheckbox = checkbox;
        row.lessonName = lesson.name;
        row.append(checkbox, name);
        lessonList.append(row);
    });
}

let activityMapMonth = null;
let activityMapSelectedDate = "";

function getActivityMapElements() {
    return {
        monthLabel: document.getElementById("activityMapMonth"),
        monthlyClassesAttended: document.getElementById("activityMonthlyClassesAttended"),
        grid: document.getElementById("activityCalendarGrid"),
        selectedTitle: document.getElementById("activitySelectedDateTitle"),
        selectedDetails: document.getElementById("activitySelectedDetails"),
        editHistoryButton: document.getElementById("activityEditHistoryButton")
    };
}

function getActivityDayState(dateKey, date) {
    const record = missionHistory[dateKey];
    const plannedGym = hasPlannedGymSchedule(getMissionHistoryScheduleForDate(date));
    if (getAttendedLessonCount(record) > 0) {
        return "completed";
    }
    if (plannedGym && dateKey < dateToKey(new Date())) {
        return "missed";
    }
    return plannedGym ? "upcoming" : "none";
}

function renderActivitySelectedDate() {
    const { selectedTitle, selectedDetails, editHistoryButton } = getActivityMapElements();
    const date = parseLocalDate(activityMapSelectedDate);
    if (!selectedTitle || !selectedDetails || !editHistoryButton) {
        return;
    }
    if (!date) {
        selectedTitle.textContent = "Select a date";
        const prompt = document.createElement("p");
        prompt.className = "activity-details-prompt";
        prompt.textContent = "Choose a calendar date to review its schedule and attendance.";
        selectedDetails.replaceChildren(prompt);
        editHistoryButton.hidden = true;
        return;
    }

    const record = missionHistory[activityMapSelectedDate];
    const todayKey = dateToKey(new Date());
    selectedTitle.textContent = date.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric"
    });
    selectedDetails.replaceChildren();

    const status = document.createElement("p");
    if (record) {
        status.textContent = "Attendance record saved.";
        editHistoryButton.textContent = "View / Edit Record";
    } else if (activityMapSelectedDate > todayKey) {
        status.textContent = "Scheduled for this day.";
        editHistoryButton.textContent = "Record Attendance";
    } else if (activityMapSelectedDate === todayKey) {
        status.textContent = "Today’s attendance has not been recorded yet.";
        editHistoryButton.textContent = "Record Attendance";
    } else {
        status.textContent = "No attendance record for this day.";
        editHistoryButton.textContent = "Record Attendance";
    }
    selectedDetails.append(status);
    editHistoryButton.hidden = false;
}

function renderMissionActivityMap() {
    const { monthLabel, monthlyClassesAttended, grid } = getActivityMapElements();
    if (!monthLabel || !monthlyClassesAttended || !grid) {
        return;
    }

    if (!activityMapMonth) {
        const now = new Date();
        activityMapMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    const year = activityMapMonth.getFullYear();
    const month = activityMapMonth.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstWeekdayOffset = (new Date(year, month, 1).getDay() + 6) % 7;
    monthLabel.textContent = activityMapMonth.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric"
    });
    const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
    const classesAttended = Object.values(missionHistory)
        .filter(record => record.date.startsWith(monthPrefix))
        .reduce((total, record) => total + getAttendedLessonCount(record), 0);
    monthlyClassesAttended.textContent = String(classesAttended);
    grid.replaceChildren();

    for (let index = 0; index < firstWeekdayOffset; index += 1) {
        const emptyDay = document.createElement("span");
        emptyDay.className = "activity-calendar-empty";
        emptyDay.setAttribute("aria-hidden", "true");
        grid.append(emptyDay);
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
        const date = new Date(year, month, day);
        const dateKey = dateToKey(date);
        const record = missionHistory[dateKey];
        const state = getActivityDayState(dateKey, date);
        const button = document.createElement("button");
        button.type = "button";
        button.className = `activity-calendar-day activity-calendar-day--${state}`;
        button.dataset.date = dateKey;
        button.setAttribute("aria-pressed", String(activityMapSelectedDate === dateKey));
        const dayName = date.toLocaleDateString("en-US", { weekday: "long" });
        const stateLabels = {
            completed: "gym visit completed",
            missed: "missed gym day",
            upcoming: "upcoming gym day",
            none: "no scheduled gym"
        };
        button.setAttribute("aria-label", `${dayName}, ${date.toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric"
        })}, ${stateLabels[state]}`);
        const dateNumber = document.createElement("span");
        dateNumber.textContent = String(day);
        const indicator = document.createElement("span");
        indicator.className = "activity-calendar-day-indicator";
        indicator.setAttribute("aria-hidden", "true");
        indicator.textContent = state === "completed" ? "✓" : state === "missed" ? "!" : state === "upcoming" ? "•" : "";
        button.append(dateNumber, indicator);
        button.addEventListener("click", () => {
            activityMapSelectedDate = dateKey;
            renderMissionActivityMap();
        });
        grid.append(button);
    }

    const trailingDays = (7 - (firstWeekdayOffset + daysInMonth) % 7) % 7;
    for (let index = 0; index < trailingDays; index += 1) {
        const emptyDay = document.createElement("span");
        emptyDay.className = "activity-calendar-empty";
        emptyDay.setAttribute("aria-hidden", "true");
        grid.append(emptyDay);
    }

    renderActivitySelectedDate();
}

function renderMissionHistoryList() {
    const { recordsList, emptyMessage } = getHistoryElements();
    if (!recordsList || !emptyMessage) {
        return;
    }

    const dates = Object.keys(missionHistory).sort().reverse();
    recordsList.replaceChildren();
    emptyMessage.hidden = dates.length > 0;
    dates.forEach(date => {
        const record = missionHistory[date];
        const item = document.createElement("li");
        const selectButton = document.createElement("button");
        selectButton.className = "history-record-select";
        selectButton.type = "button";
        const attendedClasses = getAttendedLessonCount(record);
        const classLabel = attendedClasses === 1 ? "class" : "classes";
        selectButton.textContent = `${formatSpecialDate(date)} · ${attendedClasses} ${classLabel}`;
        selectButton.addEventListener("click", () => {
            const { dateInput, status } = getHistoryElements();
            dateInput.value = date;
            renderMissionHistoryDate();
            if (status) {
                status.textContent = "";
            }
        });
        item.append(selectButton);
        recordsList.append(item);
    });
}

function summarizeBackupValue(rawValue, collectionProperty) {
    if (rawValue === null) {
        return { status: "missing", count: 0, dateRange: null };
    }
    try {
        const parsed = JSON.parse(rawValue);
        const collection = collectionProperty ? parsed?.[collectionProperty] : parsed;
        if (!collection || typeof collection !== "object" || Array.isArray(collection)) {
            return { status: "unreadable", count: null, dateRange: null };
        }
        const dates = Object.keys(collection).filter(date => parseLocalDate(date)).sort();
        return {
            status: "available",
            count: Object.keys(collection).length,
            dateRange: dates.length ? [dates[0], dates.at(-1)] : null
        };
    } catch {
        return { status: "unreadable", count: null, dateRange: null };
    }
}

function getBackupSnapshot() {
    const specialSchedules = window.localStorage.getItem(SPECIAL_SCHEDULE_STORAGE_KEY);
    const missionHistory = window.localStorage.getItem(MISSION_HISTORY_STORAGE_KEY);
    return {
        rawValues: {
            [SPECIAL_SCHEDULE_STORAGE_KEY]: specialSchedules,
            [MISSION_HISTORY_STORAGE_KEY]: missionHistory
        },
        summaries: {
            specialSchedules: summarizeBackupValue(specialSchedules, null),
            missionHistory: summarizeBackupValue(missionHistory, "records")
        }
    };
}

function formatBackupDatasetSummary(label, summary, loadState) {
    if (loadState === "error" || summary.status === "unreadable") {
        return `${label}: unreadable; raw value will be included unchanged`;
    }
    if (summary.status === "missing") {
        return `${label}: no saved data`;
    }
    const dateRange = summary.dateRange
        ? `${summary.dateRange[0]} to ${summary.dateRange[1]}`
        : "no valid dates";
    return `${label}: ${summary.count} entries · ${dateRange}`;
}

function renderBackupSummary(snapshot) {
    const summary = document.getElementById("dataBackupSummary");
    if (!summary) {
        return;
    }
    summary.textContent = [
        formatBackupDatasetSummary("Mission History", snapshot.summaries.missionHistory, missionHistoryLoadState),
        formatBackupDatasetSummary("Special Schedule", snapshot.summaries.specialSchedules, specialSchedulesLoadState)
    ].join(" · ");
}

function initializeDataBackup() {
    const backupButton = document.getElementById("downloadDataBackupButton");
    const summaryElement = document.getElementById("dataBackupSummary");
    const status = document.getElementById("dataBackupStatus");
    const downloadLink = document.getElementById("dataBackupLink");
    if (!backupButton || !summaryElement || !status || !downloadLink) {
        return;
    }

    try {
        renderBackupSummary(getBackupSnapshot());
    } catch {
        summaryElement.textContent = "Could not inspect current saved data.";
    }

    let downloadUrl = null;
    backupButton.addEventListener("click", () => {
        let snapshot;
        try {
            snapshot = getBackupSnapshot();
        } catch {
            status.textContent = "Could not read saved data for backup. No data was changed.";
            return;
        }

        const backup = {
            format: "project-salus-local-storage-backup",
            createdAt: new Date().toISOString(),
            storage: {
                [SPECIAL_SCHEDULE_STORAGE_KEY]: {
                    loadStatus: specialSchedulesLoadState,
                    rawLocalStorageValue: snapshot.rawValues[SPECIAL_SCHEDULE_STORAGE_KEY]
                },
                [MISSION_HISTORY_STORAGE_KEY]: {
                    loadStatus: missionHistoryLoadState,
                    rawLocalStorageValue: snapshot.rawValues[MISSION_HISTORY_STORAGE_KEY]
                }
            },
            summary: snapshot.summaries
        };
        if (downloadUrl) {
            URL.revokeObjectURL(downloadUrl);
        }
        downloadUrl = URL.createObjectURL(new Blob(
            [JSON.stringify(backup, null, 2)],
            { type: "application/json;charset=utf-8" }
        ));
        const link = document.createElement("a");
        link.className = "calendar-download";
        link.href = downloadUrl;
        link.download = `project-salus-backup-${dateToKey(new Date())}.json`;
        link.textContent = "Download JSON backup";
        downloadLink.replaceChildren(link);
        renderBackupSummary(snapshot);
        status.textContent = "Backup prepared. Tap the download link to save the JSON file.";
    });
}

function initializeMissionHistory() {
    const elements = getHistoryElements();
    if (!elements.dateInput || !elements.scheduleSummary ||
        !elements.lessonList || !elements.saveButton || !elements.deleteButton ||
        !elements.status || !elements.recordsList || !elements.emptyMessage) {
        return;
    }

    const loaded = loadMissionHistory();
    missionHistory = loaded.records;
    missionHistoryLoadState = loaded.status;
    elements.dateInput.value = dateToKey(new Date());
    elements.saveButton.disabled = loaded.status === "error";
    elements.deleteButton.disabled = loaded.status === "error";
    elements.dateInput.addEventListener("change", () => {
        if (missionHistoryLoadState !== "error") {
            elements.status.textContent = "";
        }
        renderMissionHistoryDate();
    });
    elements.saveButton.addEventListener("click", () => {
        if (missionHistoryLoadState === "error") {
            elements.status.textContent = loaded.error;
            return;
        }
        const dateKey = elements.dateInput.value;
        const date = parseLocalDate(dateKey);
        if (!date) {
            elements.status.textContent = "Select a valid date before saving.";
            return;
        }

        const scheduledEvents = getMissionHistoryScheduleForDate(date);
        const lessons = Array.from(elements.lessonList.children)
            .filter(row => row.attendanceCheckbox)
            .map(row => ({
                id: row.dataset.lessonId,
                name: row.lessonName,
                attended: row.attendanceCheckbox.checked
            }));
        if (!saveMissionAttendance(dateKey, scheduledEvents, lessons)) {
            elements.status.textContent = "Could not save mission history in this browser.";
            return;
        }
        renderMissionHistoryDate();
        elements.status.textContent = "Mission history saved.";
    });
    elements.deleteButton.addEventListener("click", () => {
        if (missionHistoryLoadState === "error") {
            elements.status.textContent = loaded.error;
            return;
        }
        const dateKey = elements.dateInput.value;
        if (!missionHistory[dateKey]) {
            return;
        }
        const updatedRecords = { ...missionHistory };
        delete updatedRecords[dateKey];
        if (!persistMissionHistory(updatedRecords)) {
            elements.status.textContent = "Could not save changes in this browser.";
            return;
        }
        missionHistory = updatedRecords;
        renderMissionHistoryDate();
        renderMissionHistoryList();
        renderMissionActivityMap();
        elements.status.textContent = "Mission history record deleted.";
    });
    renderMissionHistoryDate();
    renderMissionHistoryList();
    elements.status.textContent = loaded.error;
}

function initializeMissionActivityMap() {
    const {
        grid,
        monthlyClassesAttended,
        selectedTitle,
        selectedDetails,
        editHistoryButton
    } = getActivityMapElements();
    const previousButton = document.getElementById("activityMapPreviousMonth");
    const nextButton = document.getElementById("activityMapNextMonth");
    if (!grid || !monthlyClassesAttended || !selectedTitle || !selectedDetails || !editHistoryButton ||
        !previousButton || !nextButton) {
        return;
    }

    const now = new Date();
    activityMapMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    activityMapSelectedDate = dateToKey(now);
    previousButton.addEventListener("click", () => {
        activityMapMonth = new Date(
            activityMapMonth.getFullYear(),
            activityMapMonth.getMonth() - 1,
            1
        );
        activityMapSelectedDate = "";
        renderMissionActivityMap();
    });
    nextButton.addEventListener("click", () => {
        activityMapMonth = new Date(
            activityMapMonth.getFullYear(),
            activityMapMonth.getMonth() + 1,
            1
        );
        activityMapSelectedDate = "";
        renderMissionActivityMap();
    });
    editHistoryButton.addEventListener("click", () => {
        const historyDate = document.getElementById("historyDate");
        const historyStatus = document.getElementById("historyStatus");
        const historyCard = document.getElementById("missionHistoryCard");
        if (!historyDate || !parseLocalDate(activityMapSelectedDate)) {
            return;
        }
        historyDate.value = activityMapSelectedDate;
        if (historyStatus) {
            historyStatus.textContent = "";
        }
        renderMissionHistoryDate();
        historyCard?.scrollIntoView?.({ behavior: "smooth", block: "start" });
        historyDate.focus?.();
    });
    renderMissionActivityMap();
}

function initializeTabNavigation() {
    const tabs = [
        document.getElementById("missionTabButton"),
        document.getElementById("reviewTabButton"),
        document.getElementById("calendarTabButton")
    ];
    if (tabs.some(tab => !tab)) {
        return;
    }

    const navigation = document.querySelector(".tab-navigation");
    if (navigation) {
        const scrollThreshold = 12;
        let lastScrollPosition = Math.max(0, window.scrollY || window.pageYOffset || 0);
        let accumulatedScroll = 0;
        let lastDirection = 0;
        let shouldHideNavigation = false;

        function setNavigationHidden(hidden) {
            shouldHideNavigation = hidden;
            if (hidden && navigation.contains(document.activeElement)) {
                return;
            }
            navigation.classList.toggle("tab-navigation--hidden", hidden);
            navigation.inert = hidden;
        }

        navigation.addEventListener("focusout", event => {
            if (shouldHideNavigation && !navigation.contains(event.relatedTarget)) {
                navigation.classList.toggle("tab-navigation--hidden", true);
                navigation.inert = true;
            }
        });

        window.addEventListener("scroll", () => {
            const scrollPosition = Math.max(0, window.scrollY || window.pageYOffset || 0);
            const delta = scrollPosition - lastScrollPosition;
            lastScrollPosition = scrollPosition;

            if (scrollPosition === 0) {
                accumulatedScroll = 0;
                lastDirection = 0;
                setNavigationHidden(false);
                return;
            }
            if (delta === 0) {
                return;
            }

            const direction = Math.sign(delta);
            accumulatedScroll = direction === lastDirection ? accumulatedScroll + delta : delta;
            lastDirection = direction;
            if (accumulatedScroll >= scrollThreshold) {
                setNavigationHidden(true);
            } else if (accumulatedScroll <= -scrollThreshold) {
                setNavigationHidden(false);
            }
        }, { passive: true });
    }

    function activateTab(tab, moveFocus = false) {
        tabs.forEach(candidate => {
            const selected = candidate === tab;
            candidate.setAttribute("aria-selected", String(selected));
            candidate.tabIndex = selected ? 0 : -1;
            const panel = document.getElementById(candidate.getAttribute("aria-controls"));
            if (panel) {
                panel.hidden = !selected;
            }
        });
        if (moveFocus) {
            tab.focus();
        }
    }

    tabs.forEach((tab, index) => {
        tab.addEventListener("click", () => activateTab(tab));
        tab.addEventListener("keydown", event => {
            let nextIndex;
            if (event.key === "ArrowRight") {
                nextIndex = (index + 1) % tabs.length;
            } else if (event.key === "ArrowLeft") {
                nextIndex = (index - 1 + tabs.length) % tabs.length;
            } else if (event.key === "Home") {
                nextIndex = 0;
            } else if (event.key === "End") {
                nextIndex = tabs.length - 1;
            } else {
                return;
            }
            event.preventDefault();
            activateTab(tabs[nextIndex], true);
        });
    });
}

applySpecialSchedules();
initializeTabNavigation();
initializeMissionHistory();
initializeMissionActivityMap();
initializeSpecialScheduleManagement();
initializeDataBackup();
updateMissionDisplay();
setInterval(updateMissionDisplay, 1000);

if (button) {
    let downloadUrls = [];

    button.addEventListener("click", () => {
        const startDate = document.getElementById("startDate").value;
        const endDate = document.getElementById("endDate").value;
        const result = document.getElementById("result");
        const selectedTypes = CALENDAR_TYPES.filter(({ type }) =>
            document.getElementById(`include${type[0].toUpperCase()}${type.slice(1)}`).checked
        );

        downloadUrls.forEach(url => URL.revokeObjectURL(url));
        downloadUrls = [];
        result.replaceChildren();

        if (!startDate) {
            result.innerText = "⚠️ Please enter a start date.";
            return;
        }

        if (!endDate) {
            result.innerText = "⚠️ Please enter an end date.";
            return;
        }

        const start = parseLocalDate(startDate);
        const end = parseLocalDate(endDate);

        if (!start || !end) {
            result.innerText = "⚠️ Please enter valid dates.";
            return;
        }

        if (start > end) {
            result.innerText = "⚠️ End date must be on or after the start date.";
            return;
        }

        if (selectedTypes.length === 0) {
            result.innerText = "⚠️ Select at least one calendar to generate.";
            return;
        }

        const downloads = document.createElement("div");
        downloads.className = "calendar-downloads";
        selectedTypes.forEach(({ type, name }) => {
            const events = window.SALUS_SCHEDULE.getEventsByType(start, end, type);
            const ics = createICS(events);
            const fileName = `${name}.ics`;
            const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
            downloadUrls.push(url);

            const link = document.createElement("a");
            link.className = "calendar-download";
            link.href = url;
            link.download = fileName;
            link.textContent = `Download ${name} (${events.length} events)`;
            downloads.append(link);
        });

        result.append(
            document.createTextNode("✅ Calendars generated successfully."),
            downloads
        );
    });
}