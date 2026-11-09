(() => {
    const WEEKLY_SCHEDULE = {
        1: [
            { id: "departure", type: "departure", label: "出発", start: "12:55", end: "13:40" },
            { id: "preparation", type: "preparation", label: "準備", start: "13:40", end: "13:50" },
            { id: "walk-1", type: "walk", label: "ウォーキング ①", start: "13:50", end: "14:05", speed: "5.0 km/h", incline: "傾斜4%" },
            { id: "lesson-megadanz", type: "lesson", label: "MEGADANZ", start: "14:15", end: "15:00" },
            { id: "walk-2", type: "walk", label: "ウォーキング ②", start: "15:00", end: "15:15", speed: "4.8 km/h", incline: "傾斜3%" }
        ],
        2: [
            { id: "departure", type: "departure", label: "出発", start: "11:40", end: "12:25" },
            { id: "preparation", type: "preparation", label: "準備", start: "12:25", end: "12:35" },
            { id: "walk-1", type: "walk", label: "ウォーキング ①", start: "12:35", end: "12:50", speed: "5.0 km/h", incline: "傾斜4%" },
            { id: "lesson-zumba", type: "lesson", label: "ZUMBA", start: "13:00", end: "13:45" },
            { id: "walk-2", type: "walk", label: "ウォーキング ②", start: "13:45", end: "14:05", speed: "4.8 km/h", incline: "傾斜3%" },
            { id: "lesson-dark-box", type: "lesson", label: "Dark Box", start: "14:15", end: "14:45" },
            { id: "walk-3", type: "walk", label: "ウォーキング ③", start: "14:45", end: "15:00", speed: "4.8 km/h", incline: "傾斜3%" }
        ],
        5: [
            { id: "departure", type: "departure", label: "出発", start: "11:40", end: "12:25" },
            { id: "preparation", type: "preparation", label: "準備", start: "12:25", end: "12:35" },
            { id: "walk-1", type: "walk", label: "ウォーキング ①", start: "12:35", end: "12:50", speed: "5.0 km/h", incline: "傾斜4%" },
            { id: "lesson-fight-do", type: "lesson", label: "Fight Do", start: "13:00", end: "13:30" },
            { id: "walk-2", type: "walk", label: "ウォーキング ②", start: "13:30", end: "13:50", speed: "4.8 km/h", incline: "傾斜3%" },
            { id: "lesson-group-centergy", type: "lesson", label: "Group Centergy", start: "14:00", end: "14:45" },
            { id: "walk-3", type: "walk", label: "ウォーキング ③", start: "14:45", end: "15:00", speed: "4.8 km/h", incline: "傾斜3%" }
        ]
    };

    // Date keys use local YYYY-MM-DD. Closed days require an explicit date override to reopen.
    // temporaryClosures use { startDate, endDate, scope: "gym" | "lesson", eventIds? }.
    // date overrides use { date, events, reopenClosedDay? }; holiday policies are "open" or "closed".
    const SCHEDULE_CONFIG = {
        weeklySchedule: WEEKLY_SCHEDULE,
        closedWeekdays: [0, 4, 6],
        closureDates: [],
        defaultHolidayPolicy: "closed",
        holidayPolicyOverrides: [],
        temporaryClosures: [],
        dateOverrides: [],
        eventCancellations: []
    };
    const WEEKDAY_NAMES = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];

    function toDateKey(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    function isValidDate(date) {
        return date instanceof Date && !Number.isNaN(date.getTime());
    }

    function dateKeyForParts(year, month, day) {
        return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }

    function nthWeekdayOfMonth(year, month, weekday, occurrence) {
        const firstWeekday = new Date(year, month - 1, 1).getDay();
        return 1 + (weekday - firstWeekday + 7) % 7 + (occurrence - 1) * 7;
    }

    function addHoliday(holidays, year, month, day, name) {
        holidays.set(dateKeyForParts(year, month, day), name);
    }

    function addNationalHolidaysBetween(holidays, year) {
        if (year < 1986) {
            return;
        }

        const date = new Date(year, 0, 1);
        while (date.getFullYear() === year) {
            const dateKey = toDateKey(date);
            if (!holidays.has(dateKey) && date.getDay() !== 0) {
                const previousDate = new Date(date);
                const nextDate = new Date(date);
                previousDate.setDate(previousDate.getDate() - 1);
                nextDate.setDate(nextDate.getDate() + 1);
                if (holidays.has(toDateKey(previousDate)) && holidays.has(toDateKey(nextDate))) {
                    holidays.set(dateKey, "国民の休日");
                }
            }

            date.setDate(date.getDate() + 1);
        }
    }

    function addSubstituteHolidays(holidays, year) {
        if (year < 1973) {
            return;
        }

        const sundayHolidays = [...holidays.keys()]
            .filter(dateKey => {
                const [holidayYear, month, day] = dateKey.split("-").map(Number);
                return holidayYear === year && new Date(year, month - 1, day).getDay() === 0;
            })
            .sort();

        sundayHolidays.forEach(dateKey => {
            const [, month, day] = dateKey.split("-").map(Number);
            const substitute = new Date(year, month - 1, day + 1);

            if (year < 2007) {
                const substituteKey = toDateKey(substitute);
                if (!holidays.has(substituteKey)) {
                    holidays.set(substituteKey, "振替休日");
                }
                return;
            }

            while (holidays.has(toDateKey(substitute))) {
                substitute.setDate(substitute.getDate() + 1);
            }
            holidays.set(toDateKey(substitute), "振替休日");
        });
    }

    function getJapaneseHolidays(year) {
        const holidays = new Map();
        if (!Number.isInteger(year) || year < 1948 || year > 2099) {
            return holidays;
        }

        addHoliday(holidays, year, 1, 1, "元日");
        if (year >= 1949) {
            addHoliday(
                holidays,
                year,
                1,
                year >= 2000 ? nthWeekdayOfMonth(year, 1, 1, 2) : 15,
                "成人の日"
            );
        }
        if (year >= 1967) {
            addHoliday(holidays, year, 2, 11, "建国記念の日");
        }
        if (year >= 2020) {
            addHoliday(holidays, year, 2, 23, "天皇誕生日");
        } else if (year >= 1989) {
            addHoliday(holidays, year, 12, 23, "天皇誕生日");
        }

        if (year >= 1948) {
            addHoliday(holidays, year, 3, Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4)), "春分の日");
            addHoliday(holidays, year, 9, Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4)), "秋分の日");
        }

        if (year < 1989) {
            addHoliday(holidays, year, 4, 29, "天皇誕生日");
        } else if (year < 2007) {
            addHoliday(holidays, year, 4, 29, "みどりの日");
        } else {
            addHoliday(holidays, year, 4, 29, "昭和の日");
            addHoliday(holidays, year, 5, 4, "みどりの日");
        }
        addHoliday(holidays, year, 5, 3, "憲法記念日");
        addHoliday(holidays, year, 5, 5, "こどもの日");

        if (year >= 1996) {
            const marineDay = year === 2020
                ? 23
                : year === 2021
                    ? 22
                    : year >= 2003
                        ? nthWeekdayOfMonth(year, 7, 1, 3)
                        : 20;
            addHoliday(holidays, year, 7, marineDay, "海の日");
        }
        if (year >= 2016) {
            addHoliday(holidays, year, 8, year === 2020 ? 10 : year === 2021 ? 8 : 11, "山の日");
        }
        if (year >= 1966) {
            const respectDay = year >= 2003
                ? nthWeekdayOfMonth(year, 9, 1, 3)
                : 15;
            addHoliday(holidays, year, 9, respectDay, "敬老の日");
        }

        if (year === 2019) {
            addHoliday(holidays, year, 5, 1, "天皇の即位の日");
            addHoliday(holidays, year, 10, 22, "即位礼正殿の儀");
        } else if (year === 1959) {
            addHoliday(holidays, year, 4, 10, "皇太子明仁親王の結婚の儀");
        } else if (year === 1989) {
            addHoliday(holidays, year, 2, 24, "昭和天皇の大喪の礼");
        } else if (year === 1990) {
            addHoliday(holidays, year, 11, 12, "即位礼正殿の儀");
        } else if (year === 1993) {
            addHoliday(holidays, year, 6, 9, "皇太子徳仁親王の結婚の儀");
        }

        if (year >= 2020 && year <= 2021) {
            addHoliday(holidays, year, 7, year === 2020 ? 24 : 23, "スポーツの日");
        } else if (year >= 2000) {
            addHoliday(
                holidays,
                year,
                10,
                nthWeekdayOfMonth(year, 10, 1, 2),
                year >= 2020 ? "スポーツの日" : "体育の日"
            );
        } else if (year >= 1966) {
            addHoliday(holidays, year, 10, 10, "体育の日");
        }
        addHoliday(holidays, year, 11, 3, "文化の日");
        addHoliday(holidays, year, 11, 23, "勤労感謝の日");

        addNationalHolidaysBetween(holidays, year);
        addSubstituteHolidays(holidays, year);
        return holidays;
    }

    function createScheduleEngine(configOverrides = {}) {
        const config = { ...SCHEDULE_CONFIG, ...configOverrides };

        function getHolidayForDate(date) {
            if (!isValidDate(date)) {
                return null;
            }

            const dateKey = toDateKey(date);
            const name = getJapaneseHolidays(date.getFullYear()).get(dateKey);
            if (!name) {
                return null;
            }

            const policyOverride = config.holidayPolicyOverrides.find(item => item.date === dateKey);
            return {
                date: dateKey,
                name,
                policy: (policyOverride?.policy ?? config.defaultHolidayPolicy) === "open"
                    ? "open"
                    : "closed"
            };
        }

        function getScheduleForDate(date, { ignoreDefaultHolidayClosure = false } = {}) {
            if (!isValidDate(date)) {
                return [];
            }

            const dateKey = toDateKey(date);
            const dateOverride = config.dateOverrides.find(item => item.date === dateKey);
            const holidayPolicyOverride = config.holidayPolicyOverrides.find(item => item.date === dateKey);
            const temporaryClosures = config.temporaryClosures.filter(closure =>
                dateKey >= closure.startDate && dateKey <= closure.endDate
            );
            const holiday = getHolidayForDate(date);
            const isClosedWeekday = config.closedWeekdays.includes(date.getDay());
            const isClosedDate = config.closureDates.includes(dateKey);
            const hasGymClosure = temporaryClosures.some(closure => closure.scope !== "lesson");
            const isHolidayClosure = holiday?.policy === "closed" &&
                !(ignoreDefaultHolidayClosure && !holidayPolicyOverride);
            const isGymClosed = isClosedWeekday || isClosedDate || hasGymClosure || isHolidayClosure;

            if (isGymClosed && dateOverride?.reopenClosedDay !== true) {
                return [];
            }

            let events;
            if (dateOverride) {
                events = dateOverride.events;
            } else if (isClosedWeekday || isClosedDate || hasGymClosure) {
                return [];
            } else {
                events = config.weeklySchedule[date.getDay()] || [];
            }

            return events
                .filter(event => {
                    const isCancelled = config.eventCancellations.some(cancellation =>
                        cancellation.date === dateKey && cancellation.eventId === event.id
                    );
                    const isLessonCancelled = temporaryClosures.some(closure =>
                        closure.scope === "lesson" &&
                        event.type === "lesson" &&
                        (!closure.eventIds || closure.eventIds.includes(event.id))
                    );
                    return !isCancelled && !isLessonCancelled;
                })
                .map(event => ({ ...event }));
        }

        function getEventsByType(startDate, endDate, type) {
            if (!isValidDate(startDate) || !isValidDate(endDate) || startDate > endDate) {
                return [];
            }

            const events = [];
            const current = new Date(
                startDate.getFullYear(),
                startDate.getMonth(),
                startDate.getDate()
            );
            const finalDate = new Date(
                endDate.getFullYear(),
                endDate.getMonth(),
                endDate.getDate()
            );

            while (current <= finalDate) {
                const dateKey = toDateKey(current);
                getScheduleForDate(current)
                    .filter(event => event.type === type)
                    .forEach(event => events.push({ dateKey, event }));
                current.setDate(current.getDate() + 1);
            }

            return events;
        }

        function findNextDeparture(now, horizonDays = 14) {
            if (!isValidDate(now) || !Number.isFinite(horizonDays) || horizonDays < 0) {
                return null;
            }

            const days = Math.floor(horizonDays);
            const lastSearchTime = new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate() + days,
                now.getHours(),
                now.getMinutes(),
                now.getSeconds(),
                now.getMilliseconds()
            );
            const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());

            for (let dayOffset = 0; dayOffset <= days; dayOffset += 1) {
                date.setDate(date.getDate() + (dayOffset === 0 ? 0 : 1));

                const departure = getScheduleForDate(date).find(event => event.type === "departure");
                if (!departure) {
                    continue;
                }

                const [hours, minutes] = departure.start.split(":").map(Number);
                const departureDate = new Date(
                    date.getFullYear(),
                    date.getMonth(),
                    date.getDate(),
                    hours,
                    minutes
                );

                if (departureDate >= now && departureDate <= lastSearchTime) {
                    return {
                        date: new Date(date),
                        weekday: WEEKDAY_NAMES[date.getDay()],
                        time: departure.start
                    };
                }
            }

            return null;
        }

        return Object.freeze({
            getHolidayForDate,
            getScheduleForDate,
            getEventsByType,
            findNextDeparture
        });
    }

    window.SALUS_SCHEDULE = Object.freeze({
        ...createScheduleEngine(),
        createScheduleEngine,
        weekdayNames: WEEKDAY_NAMES
    });
})();
