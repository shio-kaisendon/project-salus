const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

global.window = {};
require("../schedule.js");

const schedule = window.SALUS_SCHEDULE;
const localDate = value => {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
};

function parseICS(text) {
    assert.match(text, /\r\n$/);
    assert.doesNotMatch(text.replace(/\r\n/g, ""), /[\r\n]/);

    const physicalLines = text.slice(0, -2).split("\r\n");
    for (const line of physicalLines) {
        assert.ok(Buffer.byteLength(line, "utf8") <= 75, `ICS line exceeds 75 octets: ${line}`);
    }

    const lines = [];
    for (const line of physicalLines) {
        if (line.startsWith(" ") || line.startsWith("\t")) {
            assert.ok(lines.length > 0, "Continuation line has no preceding line");
            lines[lines.length - 1] += line.slice(1);
        } else {
            lines.push(line);
        }
    }

    assert.equal(lines[0], "BEGIN:VCALENDAR");
    assert.equal(lines.at(-1), "END:VCALENDAR");
    const components = [];
    const events = [];
    let eventLines = null;
    for (const line of lines) {
        if (line.startsWith("BEGIN:")) {
            const component = line.slice(6);
            components.push(component);
            if (component === "VEVENT") {
                eventLines = [];
            }
        } else if (line.startsWith("END:")) {
            const component = line.slice(4);
            assert.equal(components.pop(), component, `Mismatched ${line}`);
            if (component === "VEVENT") {
                events.push(eventLines);
                eventLines = null;
            }
        } else {
            assert.ok(components.length > 0, `Property outside a component: ${line}`);
            assert.ok(line.indexOf(":") > 0, `Malformed content line: ${line}`);
            if (components.at(-1) === "VEVENT") {
                eventLines.push(line);
            }
        }
    }
    assert.deepEqual(components, []);
    assert.ok(lines.includes("TZID:Asia/Tokyo"));
    return { lines, events };
}

function getICSProperty(eventLines, name) {
    const line = eventLines.find(item => item.startsWith(`${name}:`) || item.startsWith(`${name};`));
    return line?.slice(line.indexOf(":") + 1);
}

function makeElementMock(tagName) {
    const element = {
        tagName,
        children: [],
        attributes: {},
        dataset: {},
        listeners: {},
        textContent: "",
        value: "",
        append(...children) {
            children.forEach(child => {
                child.parentNode = this;
                this.children.push(child);
            });
            this.textContent = this.children.map(child => child.textContent || "").join("");
        },
        replaceChildren(...children) {
            this.children = [];
            this.textContent = "";
            this.append(...children);
        },
        setAttribute(name, value) {
            this.attributes[name] = value;
        },
        getAttribute(name) {
            return this.attributes[name] ?? null;
        },
        addEventListener(name, callback) {
            this.listeners[name] = callback;
        },
        emit(name, event = {}) {
            this.listeners[name]?.(event);
        },
        querySelectorAll(selector) {
            const className = selector.slice(1);
            const matches = [];
            const visit = node => {
                if (node.className?.split(" ").includes(className)) {
                    matches.push(node);
                }
                node.children?.forEach(visit);
            };
            this.children.forEach(visit);
            return matches;
        },
        querySelector(selector) {
            return this.querySelectorAll(selector)[0] || null;
        },
        remove() {
            this.parentNode.children = this.parentNode.children.filter(child => child !== this);
        },
        reset() {},
        showModal() {
            this.open = true;
        },
        close() {
            this.open = false;
        },
        focus() {
            this.focused = true;
        }
    };
    return element;
}

function createSpecialScheduleContext(storage, fixedNow = [2026, 10, 2, 10, 0]) {
    const elements = new Map();
    const blobs = [];
    const ids = [
        "todaySchedule", "nextGymDayDate", "nextGymDaySchedule", "nextMission",
        "upcomingGymDayCard", "upcomingGymDayDate", "upcomingGymDaySchedule",
        "nextMissionEmoji", "nextMissionName", "result", "startDate", "endDate",
        "missionTabButton", "reviewTabButton", "calendarTabButton",
        "missionTab", "reviewTab", "calendarTab", "historyDate",
        "historyScheduleSummary", "gymVisitCheckbox", "historyLessonList",
        "saveHistoryButton", "deleteHistoryButton", "historyStatus",
        "missionHistoryList", "missionHistoryEmpty", "reportMonth",
        "reportMonthLabel", "reportGymVisits", "reportClassesAttended",
        "reportAttendanceRate", "reportPlannedDays", "reportMissedDays",
        "calendarButton", "specialScheduleButton", "specialScheduleDialog",
        "specialScheduleForm", "specialDateSchedules", "specialScheduleMessage",
        "specialStartDate", "specialEndDate",
        "specialScheduleStatus", "closeSpecialScheduleButton",
        "cancelSpecialScheduleButton",
        "specialScheduleList", "specialScheduleEmpty"
    ];
    ids.forEach(id => elements.set(id, makeElementMock(id)));
    [
        ["missionTabButton", "missionTab"],
        ["reviewTabButton", "reviewTab"],
        ["calendarTabButton", "calendarTab"]
    ].forEach(([buttonId, panelId], index) => {
        const button = elements.get(buttonId);
        button.setAttribute("aria-controls", panelId);
        button.setAttribute("aria-selected", String(index === 0));
    });
    elements.get("startDate").value = "2026-11-10";
    elements.get("endDate").value = "2026-11-12";
    for (const type of ["departure", "lesson", "walk"]) {
        elements.set(`include${type[0].toUpperCase()}${type.slice(1)}`, { checked: true });
    }

    const document = {
        getElementById: id => elements.get(id) || null,
        createElement: makeElementMock,
        createTextNode: textContent => ({ textContent })
    };
    class FixedDate extends Date {
        constructor(...args) {
            super(...(args.length ? args : fixedNow));
        }
    }
    const localStorage = {
        getItem(key) {
            return storage.get(key) ?? null;
        },
        setItem(key, value) {
            storage.set(key, value);
        }
    };
    const context = vm.createContext({
        Blob,
        Date: FixedDate,
        TextEncoder,
        URL: {
            createObjectURL(blob) {
                blobs.push(blob);
                return `blob:special-${blobs.length}`;
            },
            revokeObjectURL() {}
        },
        document,
        setInterval() {},
        window: { localStorage }
    });

    vm.runInContext(readFileSync(path.join(__dirname, "../schedule.js"), "utf8"), context);
    vm.runInContext(readFileSync(path.join(__dirname, "../script.js"), "utf8"), context);
    return { context, elements, blobs };
}

test("keeps the weekly schedule and regular closures", () => {
    assert.deepEqual(
        schedule.getScheduleForDate(localDate("2026-11-02")).map(event => event.type),
        ["departure", "preparation", "walk", "lesson", "walk"]
    );
    assert.equal(schedule.getScheduleForDate(localDate("2026-11-10")).length, 7);
    assert.equal(schedule.getScheduleForDate(localDate("2026-11-06")).length, 7);
    assert.deepEqual(
        ["2026-11-04", "2026-11-05", "2026-11-07", "2026-11-08"]
            .map(date => schedule.getScheduleForDate(localDate(date))),
        [[], [], [], []]
    );
});

test("applies Japanese public holidays and substitute holidays", () => {
    const emperorBirthday = localDate("2026-02-23");
    const substituteHoliday = localDate("2026-05-06");

    assert.deepEqual(schedule.getScheduleForDate(emperorBirthday), []);
    assert.deepEqual(schedule.getHolidayForDate(emperorBirthday), {
        date: "2026-02-23",
        name: "天皇誕生日",
        policy: "closed"
    });
    assert.deepEqual(schedule.getHolidayForDate(substituteHoliday), {
        date: "2026-05-06",
        name: "振替休日",
        policy: "closed"
    });
    assert.equal(schedule.getHolidayForDate(localDate("2026-05-07")), null);
    assert.deepEqual(schedule.getHolidayForDate(localDate("2019-04-30")), {
        date: "2019-04-30",
        name: "国民の休日",
        policy: "closed"
    });

    const openHolidaySchedule = schedule.createScheduleEngine({
        holidayPolicyOverrides: [{ date: "2026-02-23", policy: "open" }]
    });
    assert.equal(openHolidaySchedule.getScheduleForDate(emperorBirthday).length, 5);
});

test("full-gym temporary closures suppress all schedules", () => {
    const engine = schedule.createScheduleEngine({
        temporaryClosures: [{
            startDate: "2026-11-09",
            endDate: "2026-11-09",
            scope: "gym"
        }]
    });

    assert.deepEqual(engine.getScheduleForDate(localDate("2026-11-09")), []);
});

test("lesson cancellations remove only the selected lesson", () => {
    const engine = schedule.createScheduleEngine({
        temporaryClosures: [{
            startDate: "2026-11-10",
            endDate: "2026-11-10",
            scope: "lesson",
            eventIds: ["lesson-zumba"]
        }]
    });
    const events = engine.getScheduleForDate(localDate("2026-11-10"));

    assert.equal(events.some(event => event.id === "lesson-zumba"), false);
    assert.equal(events.some(event => event.type === "departure"), true);
    assert.equal(events.some(event => event.type === "walk"), true);
    assert.equal(events.some(event => event.id === "lesson-dark-box"), true);
});

test("a date override cannot reopen a closed day without explicit permission", () => {
    const events = [{ id: "override", type: "departure", label: "個別予定", start: "10:00", end: "10:30" }];
    const closedOverride = schedule.createScheduleEngine({
        temporaryClosures: [{
            startDate: "2026-11-09",
            endDate: "2026-11-09",
            scope: "gym"
        }],
        dateOverrides: [{ date: "2026-11-09", events }]
    });
    const reopenedOverride = schedule.createScheduleEngine({
        temporaryClosures: [{
            startDate: "2026-11-09",
            endDate: "2026-11-09",
            scope: "gym"
        }],
        dateOverrides: [{ date: "2026-11-09", events, reopenClosedDay: true }]
    });

    assert.deepEqual(closedOverride.getScheduleForDate(localDate("2026-11-09")), []);
    assert.deepEqual(reopenedOverride.getScheduleForDate(localDate("2026-11-09")), events);
});

test("a special schedule can reopen a Japanese public holiday", () => {
    const date = localDate("2026-02-23");
    const events = [{
        id: "special-departure",
        type: "departure",
        label: "特別出発",
        start: "10:00",
        end: "10:30"
    }];
    const closedOverride = schedule.createScheduleEngine({
        dateOverrides: [{ date: "2026-02-23", events }]
    });
    const reopenedOverride = schedule.createScheduleEngine({
        dateOverrides: [{ date: "2026-02-23", events, reopenClosedDay: true }]
    });

    assert.deepEqual(closedOverride.getScheduleForDate(date), []);
    assert.deepEqual(reopenedOverride.getScheduleForDate(date), events);
    assert.deepEqual(
        reopenedOverride.getEventsByType(date, date, "departure"),
        [{ dateKey: "2026-02-23", event: events[0] }]
    );
});

test("special schedules are independent by date and preserve drafts across range changes", async () => {
    const storage = new Map();
    const { context, elements, blobs } = createSpecialScheduleContext(storage);
    const dateSchedules = elements.get("specialDateSchedules");
    const getDay = date => dateSchedules.children.find(section => section.dataset.date === date);
    const setValue = (date, selector, value) => {
        const input = getDay(date).querySelector(selector);
        input.value = value;
        input.emit("input");
    };
    const addLesson = (date, lesson) => {
        const day = getDay(date);
        day.children.find(child => child.className === "text-button").emit("click");
        const row = day.querySelectorAll(".special-lesson-row").at(-1);
        for (const [selector, value] of Object.entries({
            ".lesson-name": lesson.name,
            ".lesson-emoji": lesson.emoji,
            ".lesson-start": lesson.start,
            ".lesson-end": lesson.end
        })) {
            const input = row.querySelector(selector);
            input.value = value;
            input.emit("input");
        }
        return row;
    };

    elements.get("specialScheduleButton").emit("click");
    assert.equal(elements.get("specialScheduleDialog").open, true);
    assert.deepEqual(dateSchedules.children.map(section => section.dataset.date), [
        "2026-11-10", "2026-11-11", "2026-11-12"
    ]);
    const markup = readFileSync(path.join(__dirname, "../index.html"), "utf8");
    assert.ok(markup.indexOf("id=\"specialScheduleButton\"") > markup.indexOf("id=\"endDate\""));
    assert.ok(markup.indexOf("id=\"specialScheduleButton\"") < markup.indexOf("class=\"form-group calendar-types\""));
    assert.ok(markup.indexOf("class=\"form-group calendar-types\"") < markup.indexOf("id=\"calendarButton\""));
    const stylesheet = readFileSync(path.join(__dirname, "../style.css"), "utf8");
    const getRuleBody = selector => {
        const ruleStart = stylesheet.indexOf(selector);
        return stylesheet.slice(ruleStart).match(/\{([^}]*)\}/)?.[1] || "";
    };
    assert.match(stylesheet, /--text:\s*#38291F/i);
    assert.ok(getRuleBody(".special-schedule-dialog").includes("overflow-y: auto"));
    const inputRule = getRuleBody(".special-schedule-dialog input");
    assert.ok(inputRule.includes("width: 100%"));
    assert.ok(inputRule.includes("min-width: 0"));
    assert.ok(inputRule.includes("box-sizing: border-box"));
    const lessonRule = getRuleBody(".special-lesson-row");
    assert.ok(lessonRule.includes("grid-template-columns: minmax(0,"));
    assert.ok(lessonRule.includes("min-width: 0"));
    assert.ok(lessonRule.includes("max-width: 100%"));
    assert.ok(getRuleBody(".special-departure-fields").includes("grid-template-columns: minmax(0, 1fr)"));
    const dateGridRule = getRuleBody(".special-schedule-dialog #specialScheduleForm > .special-schedule-date-grid");
    assert.ok(dateGridRule.includes("grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)"));
    assert.ok(dateGridRule.includes("gap: 12px"));
    assert.ok(dateGridRule.includes("column-gap: 16px"));
    assert.ok(dateGridRule.includes("width: min(100%, 18rem)"));
    assert.ok(dateGridRule.includes("max-width: calc(100% - 14px)"));
    assert.ok(dateGridRule.includes("margin-inline: 14px 0"));
    const startDateWrapperRule = getRuleBody(".special-schedule-dialog .special-schedule-date-grid > .form-group:first-child");
    assert.ok(startDateWrapperRule.includes("padding-inline-end: 8px"));
    assert.ok(startDateWrapperRule.includes("box-sizing: border-box"));
    const endDateWrapperRule = getRuleBody(".special-schedule-dialog .special-schedule-date-grid > .form-group:last-child");
    assert.ok(endDateWrapperRule.includes("padding-inline-start: 8px"));
    assert.ok(endDateWrapperRule.includes("box-sizing: border-box"));
    const dateInputRule = getRuleBody(".special-schedule-dialog .special-schedule-date-grid input[type=\"date\"]");
    assert.ok(dateInputRule.includes("width: 100%"));
    assert.ok(dateInputRule.includes("min-width: 0"));
    assert.ok(dateInputRule.includes("box-sizing: border-box"));
    const formChildRule = getRuleBody(".special-schedule-dialog form > *");
    assert.ok(formChildRule.includes("width: 100%"));
    assert.ok(formChildRule.includes("box-sizing: border-box"));
    assert.equal((stylesheet.match(/\.special-schedule-date-grid/g) || []).length, 4);
    assert.ok(stylesheet.includes(".special-date-schedules {\n        padding: 2px 0 8px;"));

    setValue("2026-11-10", ".special-departure-time", "11:40");
    addLesson("2026-11-10", {
        name: "ZUMBA",
        emoji: "💃",
        start: "13:00",
        end: "13:45"
    });
    addLesson("2026-11-10", {
        name: "DARK BOX",
        emoji: "🥊🧑‍🚀",
        start: "14:15",
        end: "14:45"
    });
    assert.deepEqual(
        getDay("2026-11-10").querySelector(".special-lesson-row")
            .querySelector(".special-lesson-identity").children
            .map(label => label.children[0].textContent),
        ["Emoji", "Lesson name"]
    );
    const removableLesson = addLesson("2026-11-10", {
        name: "Temporary",
        emoji: "🧪",
        start: "15:00",
        end: "15:30"
    });
    removableLesson.querySelector(".remove-lesson-button").emit("click");
    assert.equal(getDay("2026-11-10").querySelectorAll(".special-lesson-row").length, 2);

    setValue("2026-11-11", ".special-departure-time", "12:55");
    addLesson("2026-11-11", {
        name: "MEGADANZ",
        emoji: "🕺",
        start: "14:15",
        end: "15:00"
    });
    addLesson("2026-11-11", {
        name: "Open Gym",
        emoji: "",
        start: "15:10",
        end: "15:30"
    });

    elements.get("specialEndDate").value = "2026-11-13";
    elements.get("specialEndDate").emit("change");
    assert.deepEqual(dateSchedules.children.map(section => section.dataset.date), [
        "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"
    ]);
    assert.equal(getDay("2026-11-10").querySelector(".special-departure-time").value, "11:40");
    assert.equal(getDay("2026-11-11").querySelectorAll(".special-lesson-row").length, 2);

    elements.get("specialEndDate").value = "2026-11-09";
    elements.get("specialEndDate").emit("change");
    assert.match(elements.get("specialScheduleMessage").textContent, /on or after/);
    assert.equal(dateSchedules.children.length, 4);
    elements.get("specialEndDate").value = "2026-11-12";
    elements.get("specialEndDate").emit("change");
    assert.deepEqual(dateSchedules.children.map(section => section.dataset.date), [
        "2026-11-10", "2026-11-11", "2026-11-12"
    ]);
    assert.equal(getDay("2026-11-10").querySelectorAll(".special-lesson-row").length, 2);
    assert.equal(getDay("2026-11-12").querySelectorAll(".special-lesson-row").length, 0);
    assert.equal(getDay("2026-11-12").querySelector(".special-departure-time").value, "");

    setValue("2026-11-10", ".special-departure-time", "25:00");
    elements.get("specialScheduleForm").emit("submit", { preventDefault() {} });
    assert.match(elements.get("specialScheduleMessage").textContent, /valid departure time/);
    assert.equal(storage.has("project-salus-special-schedules"), false);
    setValue("2026-11-10", ".special-departure-time", "11:40");
    const firstLessonEnd = getDay("2026-11-10").querySelectorAll(".special-lesson-row")[0]
        .querySelector(".lesson-end");
    firstLessonEnd.value = "12:59";
    firstLessonEnd.emit("input");
    elements.get("specialScheduleForm").emit("submit", { preventDefault() {} });
    assert.match(elements.get("specialScheduleMessage").textContent, /time range/);
    assert.equal(storage.has("project-salus-special-schedules"), false);
    firstLessonEnd.value = "13:45";
    firstLessonEnd.emit("input");
    elements.get("specialScheduleForm").emit("submit", { preventDefault() {} });
    const stored = JSON.parse(storage.get("project-salus-special-schedules"));
    assert.deepEqual(stored["2026-11-10"], {
        date: "2026-11-10",
        departure: { time: "11:40" },
        lessons: [
            { name: "ZUMBA", start: "13:00", end: "13:45", emoji: "💃" },
            { name: "DARK BOX", start: "14:15", end: "14:45", emoji: "🥊🧑‍🚀" }
        ]
    });
    assert.deepEqual(stored["2026-11-11"], {
        date: "2026-11-11",
        departure: { time: "12:55" },
        lessons: [
            { name: "MEGADANZ", start: "14:15", end: "15:00", emoji: "🕺" },
            { name: "Open Gym", start: "15:10", end: "15:30", emoji: "" }
        ]
    });
    assert.deepEqual(stored["2026-11-12"], {
        date: "2026-11-12",
        departure: null,
        lessons: []
    });
    assert.equal(elements.get("specialScheduleList").children.length, 3);
    assert.equal(elements.get("specialScheduleDialog").open, false);

    vm.runInContext("updateDashboard(new Date(2026, 10, 10, 9, 0))", context);
    const todayRows = elements.get("todaySchedule").children;
    assert.deepEqual(todayRows.map(item => item.children[0].children[2].textContent), [
        "DEPARTURE", "ZUMBA", "DARK BOX"
    ]);
    assert.deepEqual(todayRows.map(item => item.children[0].children[1].textContent), [
        "🚗", "💃", "🥊🧑‍🚀"
    ]);
    assert.equal(elements.get("nextMissionEmoji").textContent, "🚗");
    assert.equal(elements.get("nextMissionName").textContent, "DEPARTURE");
    vm.runInContext("updateDashboard(new Date(2026, 10, 12, 9, 0))", context);
    assert.equal(elements.get("todaySchedule").children[0].textContent, "No missions scheduled today.");

    elements.get("calendarButton").emit("click");
    const calendars = await Promise.all(blobs.map(blob => blob.text()));
    assert.equal(calendars.length, 3);
    const [departureCalendar, lessonCalendar, walkCalendar] = calendars.map(parseICS);
    assert.deepEqual(departureCalendar.events.map(event => getICSProperty(event, "DTSTART")), [
        "20261110T114000", "20261111T125500"
    ]);
    assert.deepEqual(departureCalendar.events.map(event => getICSProperty(event, "SUMMARY")), [
        "🚗 DEPARTURE", "🚗 DEPARTURE"
    ]);
    assert.deepEqual(lessonCalendar.events.map(event => getICSProperty(event, "SUMMARY")), [
        "💃 ZUMBA", "🥊🧑‍🚀 DARK BOX", "🕺 MEGADANZ", "Open Gym"
    ]);
    assert.deepEqual(lessonCalendar.events.map(event => getICSProperty(event, "DTSTART")), [
        "20261110T130000", "20261110T141500", "20261111T141500", "20261111T151000"
    ]);
    assert.equal(walkCalendar.events.length, 0);

    const reloaded = createSpecialScheduleContext(storage);
    assert.deepEqual(Array.from(vm.runInContext(
        "window.SALUS_SCHEDULE.getScheduleForDate(new Date(2026, 10, 10)).map(event => event.type)",
        reloaded.context
    )), ["departure", "lesson", "lesson"]);
    assert.deepEqual(Array.from(vm.runInContext(
        "window.SALUS_SCHEDULE.getScheduleForDate(new Date(2026, 10, 11)).map(event => event.start)",
        reloaded.context
    )), ["12:55", "14:15", "15:10"]);
    assert.deepEqual(Array.from(vm.runInContext(
        "window.SALUS_SCHEDULE.getScheduleForDate(new Date(2026, 10, 12))",
        reloaded.context
    )), []);

    reloaded.elements.get("specialScheduleList").children[0].children[1].emit("click");
    assert.equal(JSON.parse(storage.get("project-salus-special-schedules"))["2026-11-10"], undefined);
    assert.equal(vm.runInContext(
        "window.SALUS_SCHEDULE.getScheduleForDate(new Date(2026, 10, 10)).length",
        reloaded.context
    ), 7);
    assert.deepEqual(Array.from(vm.runInContext(
        "window.SALUS_SCHEDULE.getScheduleForDate(new Date(2026, 10, 11)).map(event => event.emoji)",
        reloaded.context
    )), ["🚗", "🕺", ""]);
});

test("mission history records regular and special attendance and feeds the monthly report", () => {
    const storage = new Map([[
        "project-salus-special-schedules",
        JSON.stringify({
            "2026-11-11": {
                departure: { time: "10:00" },
                lessons: [{ name: "Open Gym", start: "11:00", end: "11:45", emoji: "🏋️" }]
            }
        })
    ]]);
    const { context, elements } = createSpecialScheduleContext(storage, [2026, 10, 29, 10, 0]);
    const historyDate = elements.get("historyDate");
    const lessonList = elements.get("historyLessonList");
    const saveButton = elements.get("saveHistoryButton");
    const report = () => ({
        visits: elements.get("reportGymVisits").textContent,
        classes: elements.get("reportClassesAttended").textContent,
        rate: elements.get("reportAttendanceRate").textContent,
        planned: elements.get("reportPlannedDays").textContent,
        missed: elements.get("reportMissedDays").textContent
    });

    historyDate.value = "2026-11-10";
    historyDate.emit("change");
    assert.deepEqual(lessonList.children.map(row => row.lessonName), ["ZUMBA", "DARK BOX"]);
    elements.get("gymVisitCheckbox").checked = true;
    lessonList.children[0].attendanceCheckbox.checked = true;
    lessonList.children[1].attendanceCheckbox.checked = true;
    saveButton.emit("click");

    const stored = JSON.parse(storage.get("project-salus-mission-history"));
    assert.equal(stored.version, 1);
    assert.equal(stored.records["2026-11-10"].plannedGym, true);
    assert.equal(stored.records["2026-11-10"].gymVisited, true);
    assert.deepEqual(stored.records["2026-11-10"].lessons.map(lesson => [
        lesson.name, lesson.attended
    ]), [["ZUMBA", true], ["DARK BOX", true]]);
    assert.deepEqual(report(), {
        visits: "1",
        classes: "2",
        rate: "8%",
        planned: "13",
        missed: "12"
    });

    historyDate.value = "2026-11-11";
    historyDate.emit("change");
    assert.deepEqual(lessonList.children.map(row => row.lessonName), ["Open Gym"]);
    elements.get("gymVisitCheckbox").checked = true;
    lessonList.children[0].attendanceCheckbox.checked = true;
    saveButton.emit("click");
    assert.deepEqual(report(), {
        visits: "2",
        classes: "3",
        rate: "15%",
        planned: "13",
        missed: "11"
    });

    elements.get("specialScheduleList").children[0].children[1].emit("click");
    const afterScheduleRemoval = JSON.parse(storage.get("project-salus-mission-history"));
    assert.equal(afterScheduleRemoval.records["2026-11-11"].lessons[0].name, "Open Gym");
    assert.deepEqual(report(), {
        visits: "2",
        classes: "3",
        rate: "15%",
        planned: "13",
        missed: "11"
    });

    const regularRecord = elements.get("missionHistoryList").children[1].children[0];
    regularRecord.emit("click");
    assert.equal(historyDate.value, "2026-11-10");
    assert.equal(elements.get("gymVisitCheckbox").checked, true);
    assert.equal(lessonList.children[0].attendanceCheckbox.checked, true);
    lessonList.children[0].attendanceCheckbox.checked = false;
    saveButton.emit("click");
    assert.deepEqual(report(), {
        visits: "2",
        classes: "2",
        rate: "15%",
        planned: "13",
        missed: "11"
    });

    const reloaded = createSpecialScheduleContext(storage, [2026, 10, 29, 10, 0]);
    const reloadedHistoryDate = reloaded.elements.get("historyDate");
    reloadedHistoryDate.value = "2026-11-10";
    reloadedHistoryDate.emit("change");
    assert.equal(reloaded.elements.get("gymVisitCheckbox").checked, true);
    assert.equal(reloaded.elements.get("historyLessonList").children[0].attendanceCheckbox.checked, false);
    reloaded.elements.get("calendarTabButton").emit("click");
    reloaded.elements.get("reviewTabButton").emit("click");
    assert.equal(reloadedHistoryDate.value, "2026-11-10");
    assert.equal(reloaded.elements.get("historyLessonList").children[0].attendanceCheckbox.checked, false);

    const reportMonth = reloaded.elements.get("reportMonth");
    reportMonth.value = "2026-10";
    reportMonth.emit("change");
    assert.equal(reloaded.elements.get("reportGymVisits").textContent, "0");
    assert.equal(reloaded.elements.get("reportClassesAttended").textContent, "0");
    assert.notEqual(reloaded.elements.get("reportPlannedDays").textContent, "0");
    reportMonth.value = "2026-11";
    reportMonth.emit("change");
    reloaded.elements.get("deleteHistoryButton").emit("click");
    const afterDelete = JSON.parse(storage.get("project-salus-mission-history"));
    assert.equal(afterDelete.records["2026-11-10"], undefined);
    assert.ok(afterDelete.records["2026-11-11"]);
});

test("mission history looks up November 3 and regular Tuesdays by local weekday", () => {
    const { context, elements } = createSpecialScheduleContext(new Map(), [2026, 10, 10, 10, 0]);
    const historyDate = elements.get("historyDate");
    const lessonList = elements.get("historyLessonList");
    historyDate.value = "2026-11-03";
    historyDate.emit("change");

    assert.equal(localDate("2026-11-03").getDay(), 2);
    assert.deepEqual(lessonList.children.map(row => [
        row.lessonName,
        row.attendanceCheckbox.checked
    ]), [["ZUMBA", false], ["DARK BOX", false]]);
    assert.equal(elements.get("historyScheduleSummary").textContent.startsWith("Scheduled gym day"), true);

    historyDate.value = "2026-11-10";
    historyDate.emit("change");
    assert.deepEqual(lessonList.children.map(row => row.lessonName), ["ZUMBA", "DARK BOX"]);
    assert.deepEqual(
        JSON.parse(JSON.stringify(vm.runInContext(
            "getMissionHistoryScheduleForDate(parseLocalDate('2026-11-10')).filter(event => event.type === 'lesson').map(event => [event.label, event.start, event.end])",
            context
        ))),
        [["ZUMBA", "13:00", "13:45"], ["Dark Box", "14:15", "14:45"]]
    );
});

test("a Special Schedule Day replaces the regular schedule on November 3", () => {
    const storage = new Map([[
        "project-salus-special-schedules",
        JSON.stringify({
            "2026-11-03": {
                departure: { time: "09:30" },
                lessons: [{ name: "SPECIAL CLASS", start: "10:00", end: "10:45" }]
            }
        })
    ]]);
    const { context, elements } = createSpecialScheduleContext(storage, [2026, 10, 10, 10, 0]);
    elements.get("historyDate").value = "2026-11-03";
    elements.get("historyDate").emit("change");

    assert.deepEqual(
        elements.get("historyLessonList").children.map(row => row.lessonName),
        ["SPECIAL CLASS"]
    );
    assert.deepEqual(
        Array.from(vm.runInContext(
            "getMissionHistoryScheduleForDate(parseLocalDate('2026-11-03')).map(event => event.id)",
            context
        )),
        ["special-departure", "special-lesson-1"]
    );
});

test("explicit holiday closure still suppresses the history schedule lookup", () => {
    const engine = schedule.createScheduleEngine({
        holidayPolicyOverrides: [{ date: "2026-11-03", policy: "closed" }]
    });
    assert.deepEqual(
        engine.getScheduleForDate(localDate("2026-11-03"), {
            ignoreDefaultHolidayClosure: true
        }),
        []
    );
});

test("monthly attendance excludes future plans and does not miss today's schedule", () => {
    const { elements } = createSpecialScheduleContext(new Map(), [2026, 10, 10, 10, 0]);
    const dateInput = elements.get("historyDate");
    const saveButton = elements.get("saveHistoryButton");
    const recordVisit = (date, attended) => {
        dateInput.value = date;
        dateInput.emit("change");
        elements.get("gymVisitCheckbox").checked = attended;
        saveButton.emit("click");
    };
    const reportFor = month => {
        elements.get("reportMonth").value = month;
        elements.get("reportMonth").emit("change");
        return {
            visits: elements.get("reportGymVisits").textContent,
            rate: elements.get("reportAttendanceRate").textContent,
            planned: elements.get("reportPlannedDays").textContent,
            missed: elements.get("reportMissedDays").textContent
        };
    };

    recordVisit("2026-11-03", true);
    recordVisit("2026-11-10", false);
    assert.deepEqual(reportFor("2026-11"), {
        visits: "1",
        rate: "20%",
        planned: "5",
        missed: "3"
    });

    recordVisit("2026-10-05", true);
    assert.deepEqual(reportFor("2026-10"), {
        visits: "1",
        rate: "8%",
        planned: "13",
        missed: "12"
    });

    assert.deepEqual(reportFor("2026-12"), {
        visits: "0",
        rate: "0%",
        planned: "0",
        missed: "0"
    });
});

test("monthly report safely handles zero planned days and malformed history data", () => {
    const storage = new Map([[
        "project-salus-mission-history",
        JSON.stringify({ version: 99, records: { "invalid": {} } })
    ]]);
    const { context, elements } = createSpecialScheduleContext(storage);
    assert.match(elements.get("historyStatus").textContent, /could not be read/i);

    vm.runInContext(
        'window.SALUS_SCHEDULE = createScheduleEngine({ weeklySchedule: {} });' +
        'document.getElementById("reportMonth").value = "2026-11";' +
        "renderMonthlyMissionReport();",
        context
    );
    assert.equal(elements.get("reportGymVisits").textContent, "0");
    assert.equal(elements.get("reportClassesAttended").textContent, "0");
    assert.equal(elements.get("reportAttendanceRate").textContent, "0%");
    assert.equal(elements.get("reportPlannedDays").textContent, "0");
    assert.equal(elements.get("reportMissedDays").textContent, "0");
});

test("loads existing special schedules from the previous localStorage format", () => {
    const storage = new Map([[
        "project-salus-special-schedules",
        JSON.stringify({
            "2026-11-10": {
                departureTime: "10:30",
                lessons: [{ name: "Legacy Lesson", start: "11:15", end: "12:00" }]
            }
        })
    ]]);
    const { context } = createSpecialScheduleContext(storage);

    const restoredEvents = vm.runInContext(
        "window.SALUS_SCHEDULE.getScheduleForDate(new Date(2026, 10, 10)).map(event => [event.label, event.start, event.emoji])",
        context
    );
    assert.deepEqual(JSON.parse(JSON.stringify(restoredEvents)), [
        ["DEPARTURE", "10:30", "🚗"],
        ["Legacy Lesson", "11:15", ""]
    ]);
});

test("Next Mission skips holidays and closed days", () => {
    const nextDeparture = schedule.findNextDeparture(new Date(2026, 10, 2, 13, 0), 14);

    assert.equal(nextDeparture.date.getDay(), 5);
    assert.equal(nextDeparture.time, "11:40");
    assert.deepEqual(nextDeparture.date, localDate("2026-11-06"));
});

test("Dashboard and category-specific ICS downloads use the same schedule", async () => {
    const elements = new Map();
    const blobs = [];
    const makeElement = tagName => ({
        tagName,
        children: [],
        attributes: {},
        textContent: "",
        append(...children) {
            this.children.push(...children);
            this.textContent = this.children.map(child => child.textContent || "").join("");
        },
        replaceChildren(...children) {
            this.children = [...children];
        },
        setAttribute(name, value) {
            this.attributes[name] = value;
        }
    });

    for (const id of [
        "todaySchedule",
        "nextGymDayDate",
        "nextGymDaySchedule",
        "upcomingGymDayCard",
        "upcomingGymDayDate",
        "upcomingGymDaySchedule",
        "nextMission",
        "nextMissionEmoji",
        "nextMissionName",
        "result"
    ]) {
        elements.set(id, makeElement(id));
    }
    elements.set("startDate", { value: "2026-11-09" });
    elements.set("endDate", { value: "2026-11-15" });
    for (const type of ["departure", "lesson", "walk"]) {
        elements.set(`include${type[0].toUpperCase()}${type.slice(1)}`, { checked: true });
    }

    const button = makeElement("button");
    button.addEventListener = (name, callback) => {
        if (name === "click") {
            button.onClick = callback;
        }
    };
    elements.set("calendarButton", button);

    const document = {
        getElementById: id => elements.get(id) || null,
        createElement: makeElement,
        createTextNode: textContent => ({ textContent })
    };
    class FixedDate extends Date {
        constructor(...args) {
            super(...(args.length ? args : [2026, 10, 2, 10, 0]));
        }
    }
    const windowObject = {};
    const context = vm.createContext({
        Blob,
        Date: FixedDate,
        TextEncoder,
        URL: {
            createObjectURL(blob) {
                blobs.push(blob);
                return `blob:test-${blobs.length}`;
            },
            revokeObjectURL() {}
        },
        document,
        setInterval() {},
        window: windowObject
    });

    vm.runInContext(readFileSync(path.join(__dirname, "../schedule.js"), "utf8"), context);
    vm.runInContext(readFileSync(path.join(__dirname, "../script.js"), "utf8"), context);
    vm.runInContext("updateDashboard(new Date(2026, 10, 9, 10, 0))", context);

    const expectedDashboardEvents = vm.runInContext(
        "window.SALUS_SCHEDULE.getScheduleForDate(new Date(2026, 10, 9)).filter(event => event.id !== 'preparation')",
        context
    );
    assert.equal(expectedDashboardEvents.length, 4);
    assert.equal(elements.has("liveClock"), false);
    const mondayRows = elements.get("todaySchedule").children;
    assert.deepEqual(mondayRows.map(item => item.children[0].textContent), [
        "12:55🚗DEPARTURE",
        "13:50–14:05🚶1st WALK",
        "14:15–15:00💃MEGADANZ",
        "15:00–15:15🚶2nd WALK"
    ]);
    assert.deepEqual(mondayRows.map(item => item.children[1]?.textContent || ""), [
        "",
        "5.0 km/h · 4%",
        "",
        "4.8 km/h · 3%"
    ]);
    assert.deepEqual(mondayRows.map(item => item.children[0].children[1].textContent), ["🚗", "🚶", "💃", "🚶"]);
    assert.equal(elements.get("nextMissionEmoji").textContent, "🚗");
    assert.equal(elements.get("nextMissionName").textContent, "DEPARTURE");
    assert.equal(elements.get("nextMission").textContent, "Mon. 12:55");
    assert.ok(mondayRows.every(item => !item.children[0].textContent.includes("PREPARATION")));
    assert.equal(mondayRows[2].children[0].children[2].className, "mission-item-label mission-item-label--lesson");
    assert.equal(mondayRows[1].children[1].textContent, "5.0 km/h · 4%");
    assert.equal(elements.get("nextGymDayDate").textContent, "Tuesday, November 10");
    assert.deepEqual(
        elements.get("nextGymDaySchedule").children.map(item => item.children[0].textContent),
        [
            "11:40🚗DEPARTURE",
            "12:35–12:50🚶1st WALK",
            "13:00–13:45💃ZUMBA",
            "13:45–14:05🚶2nd WALK",
            "14:15–14:45🥊DARK BOX",
            "14:45–15:00🚶3rd WALK"
        ]
    );
    assert.deepEqual(
        elements.get("nextGymDaySchedule").children.map(item => item.children[1]?.textContent || ""),
        ["", "5.0 km/h · 4%", "", "4.8 km/h · 3%", "", "4.8 km/h · 3%"]
    );
    assert.ok(elements.get("nextGymDaySchedule").children.every(item =>
        !item.children[0].textContent.includes("PREPARATION")
    ));
    assert.equal(elements.get("upcomingGymDayCard").hidden, false);
    assert.equal(elements.get("upcomingGymDayDate").textContent, "Friday, November 13");
    assert.deepEqual(
        elements.get("upcomingGymDaySchedule").children.map(item => item.children[0].textContent),
        [
            "11:40🚗DEPARTURE",
            "12:35–12:50🚶1st WALK",
            "13:00–13:30🥊FIGHT DO",
            "13:30–13:50🚶2nd WALK",
            "14:00–14:45🧘GROUP CENTERGY",
            "14:45–15:00🚶3rd WALK"
        ]
    );
    assert.deepEqual(
        elements.get("upcomingGymDaySchedule").children.map(item => item.children[1]?.textContent || ""),
        ["", "5.0 km/h · 4%", "", "4.8 km/h · 3%", "", "4.8 km/h · 3%"]
    );
    const stylesheet = readFileSync(path.join(__dirname, "../style.css"), "utf8");
    const html = readFileSync(path.join(__dirname, "../index.html"), "utf8");
    assert.match(html, /<article class="glass-card upcoming-gym-day-card" id="upcomingGymDayCard" hidden>/);
    assert.match(html, /<h4>UPCOMING<\/h4>/);
    assert.match(html, /<link rel="stylesheet" href="style\.css\?v=20261109-review-input-inset">/);
    assert.match(html, /<script src="script\.js\?v=20261109-mission-history-report"><\/script>/);
    assert.match(stylesheet, /\.review-card > \.form-group\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*padding-inline:\s*12px;[^}]*box-sizing:\s*border-box;/s);
    assert.match(stylesheet, /\.review-date-input\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*box-sizing:\s*border-box;/s);
    assert.match(stylesheet, /\.next-mission-card\s*\{[^}]*justify-content:\s*flex-start;[^}]*align-items:\s*stretch;/s);
    assert.match(stylesheet, /\.next-mission-event\s*\{[^}]*white-space:\s*nowrap;[^}]*justify-content:\s*flex-start;/s);
    assert.match(stylesheet, /\.mission-list\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s);
    assert.doesNotMatch(stylesheet, /\.next-gym-day-card \.mission-list\s*\{[^}]*grid-template-columns:\s*repeat\(2/s);
    assert.match(stylesheet, /\.next-gym-day-card,\s*\.upcoming-gym-day-card\s*\{\s*grid-column:\s*1\s*\/\s*-1;[^}]*background:[^}]*border-color:/s);
    const tabletStyles = stylesheet.slice(
        stylesheet.indexOf("@media (min-width: 700px)"),
        stylesheet.indexOf("@media (min-width: 920px)")
    );
    assert.match(tabletStyles, /\.next-gym-day-card,\s*\.upcoming-gym-day-card\s*\{\s*grid-column:\s*auto;/s);
    assert.match(tabletStyles, /\.next-gym-day-card \.mission-list li,\s*\.upcoming-gym-day-card \.mission-list li\s*\{\s*grid-template-columns:\s*7\.25rem 1\.35rem minmax\(0, 1fr\);/s);
    assert.match(stylesheet, /#result:empty\s*\{\s*display:\s*none;/);
    assert.match(
        stylesheet,
        /grid-template-columns:\s*7\.25rem 1\.35rem minmax\(0,\s*1fr\)/
    );
    assert.match(stylesheet, /\.mission-item-details\s*\{\s*grid-column:\s*3\s*\/\s*-1;/);

    for (const [
        date,
        expectedLessons,
        expectedMainRows,
        expectedDetails,
        expectedEmojis,
        expectedNextEmoji,
        expectedNextName,
        expectedNextDate,
        expectedGymDayDate
    ] of [
        [
            new Date(2026, 10, 10, 10, 0),
            ["ZUMBA", "DARK BOX"],
            ["11:40🚗DEPARTURE", "12:35–12:50🚶1st WALK", "13:00–13:45💃ZUMBA", "13:45–14:05🚶2nd WALK", "14:15–14:45🥊DARK BOX", "14:45–15:00🚶3rd WALK"],
            ["", "5.0 km/h · 4%", "", "4.8 km/h · 3%", "", "4.8 km/h · 3%"],
            ["🚗", "🚶", "💃", "🚶", "🥊", "🚶"],
            "🚗",
            "DEPARTURE",
            "Tue. 11:40",
            "Friday, November 13"
        ],
        [
            new Date(2026, 10, 6, 10, 0),
            ["FIGHT DO", "GROUP CENTERGY"],
            ["11:40🚗DEPARTURE", "12:35–12:50🚶1st WALK", "13:00–13:30🥊FIGHT DO", "13:30–13:50🚶2nd WALK", "14:00–14:45🧘GROUP CENTERGY", "14:45–15:00🚶3rd WALK"],
            ["", "5.0 km/h · 4%", "", "4.8 km/h · 3%", "", "4.8 km/h · 3%"],
            ["🚗", "🚶", "🥊", "🚶", "🧘", "🚶"],
            "🚗",
            "DEPARTURE",
            "Fri. 11:40",
            "Monday, November 9"
        ]
    ]) {
        vm.runInContext(`updateDashboard(new Date(${date.getFullYear()}, ${date.getMonth()}, ${date.getDate()}, 10, 0))`, context);
        const rows = elements.get("todaySchedule").children;
        const lessonRows = rows
            .map(item => item.children[0].children[2])
            .filter(label => label.className.includes("--lesson"));
        assert.deepEqual(lessonRows.map(label => label.textContent), expectedLessons);
        assert.deepEqual(rows.map(item => item.children[0].textContent), expectedMainRows);
        assert.deepEqual(rows.map(item => item.children[0].children[1].textContent), expectedEmojis);
        assert.deepEqual(rows.map(item => item.children[1]?.textContent || ""), expectedDetails);
        assert.equal(elements.get("nextMissionEmoji").textContent, expectedNextEmoji);
        assert.equal(elements.get("nextMissionName").textContent, expectedNextName);
        assert.equal(elements.get("nextMission").textContent, expectedNextDate);
        assert.equal(elements.get("nextGymDayDate").textContent, expectedGymDayDate);
        assert.ok(elements.get("nextGymDaySchedule").children.length > 0);
    }

    for (const [referenceDate, nextGymDay, upcomingGymDay] of [
        [new Date(2026, 10, 9), "Tuesday, November 10", "Friday, November 13"],
        [new Date(2026, 10, 10), "Friday, November 13", "Monday, November 16"],
        [new Date(2026, 10, 11), "Friday, November 13", "Monday, November 16"],
        [new Date(2026, 10, 6), "Monday, November 9", "Tuesday, November 10"],
        [new Date(2026, 10, 27), "Monday, November 30", "Tuesday, December 1"]
    ]) {
        vm.runInContext(
            `updateDashboard(new Date(${referenceDate.getFullYear()}, ${referenceDate.getMonth()}, ${referenceDate.getDate()}, 10, 0))`,
            context
        );
        assert.equal(elements.get("nextGymDayDate").textContent, nextGymDay);
        assert.equal(elements.get("upcomingGymDayDate").textContent, upcomingGymDay);
        assert.equal(elements.get("upcomingGymDayCard").hidden, false);
        assert.ok(elements.get("upcomingGymDaySchedule").children.length > 0);
    }

    vm.runInContext(`{
        const getScheduleForDate = window.SALUS_SCHEDULE.getScheduleForDate;
        window.SALUS_SCHEDULE = {
            ...window.SALUS_SCHEDULE,
            getScheduleForDate(date) {
                return date.getFullYear() === 2026 && date.getMonth() === 10 && date.getDate() === 10
                    ? getScheduleForDate(date)
                    : [];
            }
        };
        updateDashboard(new Date(2026, 10, 9, 10, 0));
    }`, context);
    assert.equal(elements.get("nextGymDayDate").textContent, "Tuesday, November 10");
    assert.equal(elements.get("upcomingGymDayCard").hidden, true);
    assert.deepEqual(
        Array.from(vm.runInContext("WEEKDAY_ABBREVIATIONS", context)),
        ["Sun.", "Mon.", "Tue.", "Wed.", "Thu.", "Fri.", "Sat."]
    );

    vm.runInContext(`window.SALUS_SCHEDULE = {
        ...window.SALUS_SCHEDULE,
        findNextDeparture: () => ({
        date: new Date(2026, 10, 10),
        time: "13:00",
        event: { id: "lesson-zumba", type: "lesson", label: "ZUMBA" }
        })
    };
    updateDashboard(new Date(2026, 10, 9, 10, 0))`, context);
    assert.equal(elements.get("nextMissionEmoji").textContent, "💃");
    assert.equal(elements.get("nextMissionName").textContent, "ZUMBA");
    assert.equal(elements.get("nextMission").textContent, "Tue. 13:00");

    button.onClick();
    const calendars = await Promise.all(blobs.map(blob => blob.text()));
    assert.equal(calendars.length, 3);
    assert.doesNotMatch(calendars.join(""), /[一-龯ぁ-んァ-ン]/u);
    assert.deepEqual(
        elements.get("result").children[1].children.map(link => link.download),
        ["Departure.ics", "Lesson.ics", "Walk.ics"]
    );
    const eventTypes = ["departure", "lesson", "walk"];
    const expectedCounts = [3, 5, 8];
    const parsedCalendars = calendars.map(parseICS);
    assert.ok(parsedCalendars[0].lines.includes("DTSTART;TZID=Asia/Tokyo:20261109T125500"));
    parsedCalendars.forEach(({ lines, events }, index) => {
        assert.equal(events.length, expectedCounts[index]);

        const expectedEvents = schedule.getEventsByType(
            localDate("2026-11-09"),
            localDate("2026-11-15"),
            eventTypes[index]
        );
        assert.equal(expectedEvents.length, expectedCounts[index]);
        assert.deepEqual(events.map(event => getICSProperty(event, "UID")), expectedEvents.map(
            ({ dateKey, event }) => `${dateKey}-${event.id}@project-salus`
        ));
        assert.deepEqual(events.map(event => getICSProperty(event, "SUMMARY")), expectedEvents.map(
            ({ event }) => ({
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
            })[event.id]
        ));
        assert.deepEqual(events.map(event => getICSProperty(event, "DTSTART")), expectedEvents.map(
            ({ dateKey, event }) => `${dateKey.replaceAll("-", "")}T${event.start.replace(":", "")}00`
        ));
        assert.deepEqual(events.map(event => getICSProperty(event, "DTEND")), expectedEvents.map(
            ({ dateKey, event }) => `${dateKey.replaceAll("-", "")}T${event.end.replace(":", "")}00`
        ));
        assert.ok(events.every(event => event.some(line => line.startsWith("DTSTART;TZID=Asia/Tokyo:"))));
        assert.ok(events.every(event => event.some(line => line.startsWith("DTEND;TZID=Asia/Tokyo:"))));
    });

    const departureEvents = parsedCalendars[0].events;
    const lessonEvents = parsedCalendars[1].events;
    const walkEvents = parsedCalendars[2].events;
    assert.ok(departureEvents.every(event => getICSProperty(event, "SUMMARY") === "DEPARTURE"));
    assert.ok(departureEvents.every(event => getICSProperty(event, "DESCRIPTION") === undefined));
    assert.ok(lessonEvents.every(event => getICSProperty(event, "DESCRIPTION") === undefined));
    assert.deepEqual(walkEvents.map(event => getICSProperty(event, "DESCRIPTION")), [
        "5.0 km/h · 4%",
        "4.8 km/h · 3%",
        "5.0 km/h · 4%",
        "4.8 km/h · 3%",
        "4.8 km/h · 3%",
        "5.0 km/h · 4%",
        "4.8 km/h · 3%",
        "4.8 km/h · 3%"
    ]);

    const escapedText = "5.0 km/h, 4%; 3%\\\r\nExtra\nline";
    assert.equal(
        vm.runInContext(`escapeICSText(${JSON.stringify(escapedText)})`, context),
        "5.0 km/h\\, 4%\\; 3%\\\\\\nExtra\\nline"
    );
    const longWalkICS = vm.runInContext(`createICS([{
        dateKey: "2026-11-02",
        event: {
            id: "long-walk",
            type: "walk",
            label: ${JSON.stringify("LONG WALK ".repeat(12))},
            start: "13:50",
            end: "14:05",
            speed: "5.0 km/h",
            incline: "4%"
        }
    }])`, context);
    const parsedLongWalk = parseICS(longWalkICS);
    assert.equal(getICSProperty(parsedLongWalk.events[0], "SUMMARY"), "LONG WALK ".repeat(12));
});
