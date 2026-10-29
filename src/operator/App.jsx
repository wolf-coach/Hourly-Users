import { useCallback, useEffect, useRef, useState } from "react";
import { get, ref, remove, set } from "firebase/database";
import { AnimatePresence, motion } from "framer-motion";
import { db } from "../shared/firebase";
import Toast from "../shared/Toast";
import AnimatedNumber from "../shared/AnimatedNumber";
import { useToast } from "../shared/useToast";
import usePageStylesheet from "../shared/usePageStylesheet";
import { getActiveShift, getShiftTeamWarning } from "../shared/shiftSchedule";
import { normalizeHours } from "../shared/hours";

const REASON_PRESETS = [
    { id: "Tool Change", icon: "fa-screwdriver-wrench", label: "Tool Change" },
    { id: "AirCheck", icon: "fa-circle-xmark", label: "AirCheck" },
    { id: "Material Wait", icon: "fa-boxes-packing", label: "Material Wait" },
    { id: "Maintenance", icon: "fa-gears", label: "Maintenance" },
    { id: "Setup Adjust", icon: "fa-sliders", label: "Setup / Adjust" },
    { id: "Other", icon: "fa-ellipsis-h", label: "Other Reason" },
];

const EMPTY_HOURS = [0, 0, 0, 0, 0, 0, 0, 0];
const SESSION_META_KEY = "activeSessionMeta";
const overlayFade = {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: 0.2, ease: "easeOut" } },
    exit: { opacity: 0, transition: { duration: 0.16, ease: "easeIn" } },
};
const modalPop = {
    initial: { opacity: 0, scale: 0.96, y: 18 },
    animate: {
        opacity: 1,
        scale: 1,
        y: 0,
        transition: { type: "spring", stiffness: 360, damping: 30, mass: 0.85 },
    },
    exit: {
        opacity: 0,
        scale: 0.98,
        y: 10,
        transition: { duration: 0.15, ease: "easeIn" },
    },
};
const gridContainer = {
    initial: {},
    animate: { transition: { delayChildren: 0.04, staggerChildren: 0.055 } },
};
const gridItem = {
    initial: { opacity: 0, y: 10, scale: 0.985 },
    animate: {
        opacity: 1,
        y: 0,
        scale: 1,
        transition: { type: "spring", stiffness: 320, damping: 28 },
    },
};
const buttonTap = {
    whileHover: { y: -1 },
    whileTap: { scale: 0.975 },
    transition: { type: "spring", stiffness: 420, damping: 26 },
};
const chipTap = {
    whileHover: { y: -1 },
    whileTap: { scale: 0.96 },
    transition: { type: "spring", stiffness: 420, damping: 26 },
};
const selectorModal = modalPop;
const selectorOverlay = overlayFade;
const selectorGrid = gridContainer;
const selectorCard = gridItem;
const operatorPage = {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.28, ease: "easeOut" } },
};
const selectorRow = {
    initial: {},
    animate: { transition: { delayChildren: 0.12, staggerChildren: 0.08 } },
};
const selectorField = {
    initial: { opacity: 0, y: 12 },
    animate: {
        opacity: 1,
        y: 0,
        transition: { type: "spring", stiffness: 360, damping: 28 },
    },
};

function todayStr() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function buildLogKey(dateStr, shift, machineId, operatorId) {
    const cleanMachine = (machineId || "").replace(/\s+/g, "");
    return `${dateStr}_Shift${shift}_${cleanMachine}_${operatorId}`;
}

function normalizeReasons(value) {
    if (Array.isArray(value)) return value.filter((reason) => typeof reason === "string" && reason);
    return typeof value === "string" && value ? [value] : [];
}

export default function App() {
    usePageStylesheet("/styles/operator.css");
    const { message: toastMsg, visible: toastVisible, showToast } = useToast();

    // ---------- Catalog data ----------
    const [dbMachines, setDbMachines] = useState([]);
    const [dbParts, setDbParts] = useState([]);

    // ---------- Session ----------
    const [session, setSession] = useState({
        operatorId: "---",
        operatorName: "---",
        machineId: "",
        partName: "",
        target: 18,
        shift: "A",
        shiftDate: "",
        hours: [...EMPTY_HOURS],
        reasons: {},
        reasonNotes: {},
    });
    const sessionRef = useRef(session);
    sessionRef.current = session;

    const [loggedIn, setLoggedIn] = useState(false);
    const [restoring, setRestoring] = useState(true);
    const [cssReady, setCssReady] = useState(false);
    const [activeHour, setActiveHour] = useState(null);

    // ---------- Skeleton Timer States ----------
    const [minSkeletonTimePassed, setMinSkeletonTimePassed] = useState(false);
    const [skeletonTimedOut, setSkeletonTimedOut] = useState(false);

    // ---------- Login form ----------
    const [loginMachineId, setLoginMachineId] = useState("");
    const [loginPartName, setLoginPartName] = useState("");
    const [loginPartTarget, setLoginPartTarget] = useState(18);
    const [currentTime, setCurrentTime] = useState(() => new Date());
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [loginError, setLoginError] = useState("");
    const [loginBusy, setLoginBusy] = useState(false);

    // ---------- Welcome modal ----------
    const [welcomeOpen, setWelcomeOpen] = useState(false);
    const [welcomeInfo, setWelcomeInfo] = useState(null);

    // ---------- Other modals ----------
    const [machineModalOpen, setMachineModalOpen] = useState(false);
    const [partModalOpen, setPartModalOpen] = useState(false);
    const [reasonModalOpen, setReasonModalOpen] = useState(false);
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
    const [activeModalHour, setActiveModalHour] = useState(0);
    const [tempSelectedReason, setTempSelectedReason] = useState("");
    const [customNote, setCustomNote] = useState("");

    // ---------- Offline queue ----------
    const [pendingQueue, setPendingQueue] = useState([]);
    const [syncBusy, setSyncBusy] = useState(false);
    const activeShift = getActiveShift(currentTime);

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 30_000);
        return () => clearInterval(timer);
    }, []);

    // ==================================================================
    // SKELETON DELAY & TIMEOUT CONTROLLER
    // ==================================================================
    useEffect(() => {
        // 1. Minimum skeleton visibility duration (1000ms)
        const minTimer = setTimeout(() => {
            setMinSkeletonTimePassed(true);
        }, 1000);

        // 2. Maximum fallback timeout to avoid getting stuck (3000ms)
        const timeoutTimer = setTimeout(() => {
            setSkeletonTimedOut(true);
        }, 3000);

        return () => {
            clearTimeout(minTimer);
            clearTimeout(timeoutTimer);
        };
    }, []);

    // ==================================================================
    // CSS STYLESHEET DETECTION GUARD WITH FALLBACK
    // ==================================================================
    useEffect(() => {
        let attempts = 0;
        const checkCssLoaded = () => {
            const sheets = Array.from(document.styleSheets);
            const isOperatorCssLoaded = sheets.some((sheet) => {
                try {
                    return sheet.href && sheet.href.includes("operator.css");
                } catch {
                    return false;
                }
            });

            if (isOperatorCssLoaded || attempts > 20) {
                setCssReady(true);
            } else {
                attempts++;
                setTimeout(checkCssLoaded, 50);
            }
        };
        checkCssLoaded();
    }, []);

    // ==================================================================
    // CATALOG LOADING
    // ==================================================================
    useEffect(() => {
        (async () => {
            try {
                const machinesSnap = await get(ref(db, "machines"));
                const machines = machinesSnap.exists()
                    ? Object.values(machinesSnap.val())
                    : [
                        { id: "MSA 01", type: "Multi-Spindle CNC", target: 18 },
                        { id: "MSA 02", type: "Multi-Spindle CNC", target: 20 },
                    ];

                const partsSnap = await get(ref(db, "parts"));
                const parts = partsSnap.exists()
                    ? Object.values(partsSnap.val())
                    : [
                        { name: "T-Opal Front", code: "P-8821", target: 18 },
                        { name: "T-Opal Rear", code: "P-8822", target: 20 },
                    ];

                setDbMachines(machines);
                setDbParts(parts);

                if (machines.length > 0) setLoginMachineId(machines[0].id);
                if (parts.length > 0) {
                    setLoginPartName(parts[0].name);
                    setLoginPartTarget(parts[0].target || 18);
                }
            } catch (err) {
                console.error("Error fetching catalog from DB:", err);
            }
        })();
    }, []);

    // ==================================================================
    // SESSION RESTORE
    // ==================================================================
    useEffect(() => {
        (async () => {
            const storedMeta = sessionStorage.getItem(SESSION_META_KEY);
            if (!storedMeta) {
                setRestoring(false);
                return;
            }
            try {
                const meta = JSON.parse(storedMeta);
                const dateStr = meta.shiftDate || getActiveShift(new Date()).date;
                const logKey = buildLogKey(dateStr, meta.shift, meta.machineId, meta.operatorId);

                setSession((s) => ({
                    ...s,
                    operatorId: meta.operatorId,
                    operatorName: meta.operatorName || meta.operatorId,
                    machineId: meta.machineId,
                    partName: meta.partName,
                    shift: meta.shift,
                    shiftDate: dateStr,
                }));
                setLoggedIn(true);
                setRestoring(false);

                const snap = await get(ref(db, "daily_logs/" + logKey));
                if (snap.exists()) {
                    const existing = snap.val();
                    setSession((s) => ({
                        ...s,
                        hours: normalizeHours(existing.hours),
                        reasons: existing.reasons || {},
                        reasonNotes: existing.reasonNotes || {},
                        target: existing.hourlyTarget || 18,
                    }));
                }
                showToast(`🔄 Auto-restored (${meta.machineId})`);
            } catch (err) {
                console.error("Session auto-restore error:", err);
                setRestoring(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ==================================================================
    // OFFLINE QUEUE
    // ==================================================================
    const flushQueue = useCallback(async () => {
        if (!pendingQueue.length) {
            showToast("✅ Nothing pending — already in sync");
            return;
        }
        const remaining = [];
        for (const item of pendingQueue) {
            try {
                await set(ref(db, "daily_logs/" + item.logKey), item.payload);
            } catch {
                remaining.push(item);
            }
        }
        setPendingQueue(remaining);
        showToast(
            remaining.length
                ? `⚠️ ${remaining.length} entr${remaining.length === 1 ? "y" : "ies"} still pending`
                : "⚡ All queued entries synced"
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingQueue]);

    useEffect(() => {
        const handler = () => flushQueue();
        window.addEventListener("online", handler);
        return () => window.removeEventListener("online", handler);
    }, [flushQueue]);

    function enqueuePending(logKey, payload) {
        setPendingQueue((q) => {
            const idx = q.findIndex((item) => item.logKey === logKey);
            if (idx >= 0) {
                const copy = [...q];
                copy[idx] = { logKey, payload };
                return copy;
            }
            return [...q, { logKey, payload }];
        });
    }

    // ==================================================================
    // SAVE / AUTOSAVE
    // ==================================================================
    const autoSaveTimer = useRef(null);

    const saveCurrentMachineData = useCallback(async (silent) => {
        const s = sessionRef.current;
        if (!s.machineId || !s.operatorId || s.operatorId === "---") return;

        if (!silent) setSyncBusy(true);

        const dateStr = s.shiftDate || todayStr();
        const logKey = buildLogKey(dateStr, s.shift, s.machineId, s.operatorId);

        const payload = {
            date: dateStr,
            shift: s.shift,
            machineId: s.machineId,
            partName: s.partName,
            operatorId: s.operatorId,
            operatorName: s.operatorName || s.operatorId,
            hourlyTarget: s.target,
            hours: s.hours,
            reasons: s.reasons || {},
            reasonNotes: s.reasonNotes || {},
            totalPlan: s.target * 8,
            totalActual: s.hours.reduce((a, b) => a + Number(b), 0),
            updatedAt: new Date().toISOString(),
        };

        try {
            await set(ref(db, "daily_logs/" + logKey), payload);
            sessionStorage.setItem(
                SESSION_META_KEY,
                JSON.stringify({
                    operatorId: s.operatorId,
                    operatorName: s.operatorName,
                    machineId: s.machineId,
                    partName: s.partName,
                    shift: s.shift,
                    shiftDate: s.shiftDate,
                })
            );
            if (!silent) showToast(`⚡ Realtime DB Updated: ${s.machineId} (${s.partName})`);
        } catch (err) {
            console.error(err);
            enqueuePending(logKey, payload);
            if (!silent) showToast(`📥 Offline — entry queued`);
        } finally {
            if (!silent) setSyncBusy(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const scheduleAutoSave = useCallback(() => {
        clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = setTimeout(() => saveCurrentMachineData(true), 1000);
    }, [saveCurrentMachineData]);

    // ==================================================================
    // LOGIN
    // ==================================================================
    async function handleOperatorLogin() {
        const uname = username.trim();
        const pass = password.trim();

        if (!uname || !pass) {
            setLoginError("Please enter both username and password.");
            return;
        }
        if (!loginMachineId) {
            setLoginError("Still loading machine list — try again in a moment.");
            return;
        }

        setLoginError("");
        setLoginBusy(true);

        const userKey = uname.replace(/\s+/g, "_");

        try {
            const userSnap = await get(ref(db, "users/" + userKey));
            if (!userSnap.exists()) {
                setLoginError("User not found.");
                setLoginBusy(false);
                return;
            }

            const userData = userSnap.val();
            if (userData.password !== pass) {
                setLoginError("Invalid password.");
                setLoginBusy(false);
                return;
            }

            const mat = userData.matriculation || uname;
            const opName = userData.name || userData.fullName || uname;
            const activeShiftAtLogin = getActiveShift(new Date());
            const shift = activeShiftAtLogin.shift;
            const assignedShiftTeam = userData.shiftTeam;
            const shiftWarning = getShiftTeamWarning(assignedShiftTeam, activeShiftAtLogin);
            const dateStr = activeShiftAtLogin.date;
            const logKey = buildLogKey(dateStr, shift, loginMachineId, mat);

            let newHours = [...EMPTY_HOURS];
            let newReasons = {};
            let newReasonNotes = {};
            let newTarget = loginPartTarget;

            const snap = await get(ref(db, "daily_logs/" + logKey));
            if (snap.exists()) {
                const existing = snap.val();
                newHours = normalizeHours(existing.hours);
                newReasons = existing.reasons || {};
                newReasonNotes = existing.reasonNotes || {};
                newTarget = existing.hourlyTarget || newTarget;
            }

            const nextSession = {
                operatorId: mat,
                operatorName: opName,
                machineId: loginMachineId,
                partName: existingPartOrLogin(snap, loginPartName),
                target: newTarget,
                shift,
                shiftDate: dateStr,
                hours: newHours,
                reasons: newReasons,
                reasonNotes: newReasonNotes,
            };

            setSession(nextSession);
            setWelcomeInfo({
                operatorName: opName,
                matriculation: mat,
                machineId: loginMachineId,
                partName: nextSession.partName,
                assignedShiftTeam: ["A", "B", "C", "D"].includes(assignedShiftTeam) ? assignedShiftTeam : "",
                shiftWarning,
            });
            setWelcomeOpen(true);
        } catch (err) {
            console.error("Login error:", err);
            setLoginError("Database error during authentication.");
        } finally {
            setLoginBusy(false);
        }
    }

    function existingPartOrLogin(snap, fallbackPart) {
        if (snap && snap.exists && snap.exists() && snap.val().partName) {
            return snap.val().partName;
        }
        return fallbackPart;
    }

    function confirmWelcomeModal() {
        sessionStorage.setItem(
            SESSION_META_KEY,
            JSON.stringify({
                operatorId: session.operatorId,
                operatorName: session.operatorName,
                machineId: session.machineId,
                partName: session.partName,
                shift: session.shift,
                shiftDate: session.shiftDate,
            })
        );
        setWelcomeOpen(false);
        setLoggedIn(true);
    }

    function logoutOperator() {
        sessionStorage.removeItem(SESSION_META_KEY);
        setUsername("");
        setPassword("");
        setLoginError("");
        setActiveHour(null);
        setLoggedIn(false);
        setWelcomeOpen(false);
        setSession((s) => ({
            ...s,
            operatorId: "---",
            operatorName: "---",
            shiftDate: "",
            hours: [...EMPTY_HOURS],
            reasons: {},
            reasonNotes: {},
        }));
    }

    // ==================================================================
    // HOUR INPUT
    // ==================================================================
    function handleHourInput(h, rawVal) {
        let raw = rawVal.replace(/[^0-9]/g, "");
        if (raw.length > 1) raw = raw.replace(/^0+/, "") || "0";
        if (raw.length > 2) raw = raw.slice(0, 2);
        const num = raw === "" ? 0 : parseInt(raw, 10);

        setSession((s) => {
            const hours = [...s.hours];
            hours[h] = num;
            return { ...s, hours };
        });
        scheduleAutoSave();

    }

    function handleHourKeypad(key) {
        if (activeHour === null) return;

        const current = String(sessionRef.current.hours[activeHour] ?? "");
        let next;
        if (key === "clear") {
            next = "";
        } else if (key === "backspace") {
            next = current.slice(0, -1);
        } else {
            next = `${current === "0" ? "" : current}${key}`.slice(0, 2);
        }
        handleHourInput(activeHour, next);
    }

    // ==================================================================
    // CLEAR MACHINE DATA
    // ==================================================================
    async function confirmClearMachineData() {
        const s = sessionRef.current;
        const dateStr = s.shiftDate || todayStr();
        const logKey = buildLogKey(dateStr, s.shift, s.machineId, s.operatorId);

        try {
            await remove(ref(db, "daily_logs/" + logKey));
            setSession((prev) => ({
                ...prev,
                hours: [...EMPTY_HOURS],
                reasons: {},
                reasonNotes: {},
            }));
            setClearConfirmOpen(false);
            showToast(`🗑️ ${s.machineId} cleared for next shift`);
        } catch (err) {
            console.error(err);
            showToast(`❌ Clear failed: ${err.message}`);
        }
    }

    // ==================================================================
    // REASON MODAL
    // ==================================================================
    function openReasonModal(h) {
        setActiveModalHour(h);
        setTempSelectedReason(normalizeReasons(session.reasons && session.reasons[h]));
        setCustomNote((session.reasonNotes && session.reasonNotes[h]) || "");
        setReasonModalOpen(true);
    }

    function saveSelectedReason() {
        const note = customNote.trim();
        setSession((s) => {
            const reasons = { ...s.reasons };
            const reasonNotes = { ...s.reasonNotes };
            if (tempSelectedReason.length === 1) reasons[activeModalHour] = tempSelectedReason[0];
            else if (tempSelectedReason.length > 1) reasons[activeModalHour] = tempSelectedReason;
            else delete reasons[activeModalHour];
            if (note) reasonNotes[activeModalHour] = note;
            else delete reasonNotes[activeModalHour];
            return { ...s, reasons, reasonNotes };
        });
        setReasonModalOpen(false);
        scheduleAutoSave();
    }

    function closeModals() {
        setMachineModalOpen(false);
        setPartModalOpen(false);
        setReasonModalOpen(false);
        setClearConfirmOpen(false);
    }

    // ==================================================================
    // DERIVED METRICS
    // ==================================================================
    const totalActual = session.hours.reduce((acc, curr) => acc + Math.max(0, Number(curr) || 0), 0);
    const totalTarget = session.target * 8;
    const efficiency = totalTarget > 0 ? Math.round((totalActual / totalTarget) * 100) : 0;
    let statusColor = "var(--neon-green)";
    if (efficiency < 85) statusColor = "var(--neon-red)";
    else if (efficiency < 98) statusColor = "var(--neon-yellow)";

    // ==================================================================
    // SKELETON RENDER (WITH DELAY & TIMEOUT LOGIC)
    // ==================================================================
    const shouldShowSkeleton = (!minSkeletonTimePassed || restoring || !cssReady) && !skeletonTimedOut;

    if (shouldShowSkeleton) {
        return <DashboardSkeleton />;
    }

    return (
        <>
            <AnimatePresence>
                {!loggedIn && (
                    <LoginOverlay
                        key="login"
                        dbMachines={dbMachines}
                        dbParts={dbParts}
                        loginMachineId={loginMachineId}
                        loginPartName={loginPartName}
                        onOpenMachineModal={() => setMachineModalOpen(true)}
                        onOpenPartModal={() => setPartModalOpen(true)}
                        activeShift={activeShift}
                        username={username}
                        setUsername={setUsername}
                        password={password}
                        setPassword={setPassword}
                        loginError={loginError}
                        loginBusy={loginBusy}
                        onSubmit={handleOperatorLogin}
                    />
                )}
            </AnimatePresence>

            <AnimatePresence>
                {welcomeOpen && welcomeInfo && (
                    <WelcomeModal key="welcome" info={welcomeInfo} onConfirm={confirmWelcomeModal} />
                )}
            </AnimatePresence>

            <AnimatePresence>
                {clearConfirmOpen && (
                    <ClearConfirmModal
                        key="clear"
                        machineId={session.machineId}
                        onConfirm={confirmClearMachineData}
                        onCancel={closeModals}
                    />
                )}
            </AnimatePresence>

            <AnimatePresence>
                {machineModalOpen && (
                    <MachineModal
                        key="machine"
                        machines={dbMachines}
                        currentId={loggedIn ? session.machineId : loginMachineId}
                        onSelect={(mId) => {
                            if (loggedIn) {
                                setSession((s) => ({ ...s, machineId: mId }));
                            } else {
                                setLoginMachineId(mId);
                            }
                            closeModals();
                        }}
                        onClose={closeModals}
                    />
                )}
            </AnimatePresence>

            <AnimatePresence>
                {partModalOpen && (
                    <PartModal
                        key="part"
                        parts={dbParts}
                        currentName={loggedIn ? session.partName : loginPartName}
                        onSelect={(pName, pTarget) => {
                            if (loggedIn) {
                                setSession((s) => ({ ...s, partName: pName, target: pTarget || 18 }));
                                scheduleAutoSave();
                            } else {
                                setLoginPartName(pName);
                                setLoginPartTarget(pTarget || 18);
                            }
                            closeModals();
                        }}
                        onClose={closeModals}
                    />
                )}
            </AnimatePresence>

            <AnimatePresence>
                {reasonModalOpen && (
                    <ReasonModal
                        key="reason"
                        hour={activeModalHour}
                        tempSelectedReason={tempSelectedReason}
                        onToggleReason={(reason) => {
                            setTempSelectedReason((selected) => (
                                selected.includes(reason)
                                    ? selected.filter((item) => item !== reason)
                                    : [...selected, reason]
                            ));
                        }}
                        customNote={customNote}
                        setCustomNote={setCustomNote}
                        onSave={saveSelectedReason}
                        onClose={closeModals}
                    />
                )}
            </AnimatePresence>

            {loggedIn && (
                <>
                    <motion.header variants={operatorPage} initial="initial" animate="animate">
                        <div className="shift-info">
                            <div className="hud-badge">
                                <i className="fa-regular fa-calendar" /> <span>{session.shiftDate || todayStr()}</span>
                            </div>
                            <div className="hud-badge">
                                <i className="fa-solid fa-clock" /> SHIFT <span>{session.shift}</span>
                            </div>
                            <div className="hud-badge">
                                <i className="fa-solid fa-user-gear" /> OP ID: <span>{session.operatorId}</span>
                            </div>
                            {pendingQueue.length > 0 && (
                                <motion.button
                                    className="hud-badge badge-alert"
                                    onClick={flushQueue}
                                    {...chipTap}
                                >
                                    <i className="fa-solid fa-triangle-exclamation" /> <span>{pendingQueue.length}</span> PENDING · TAP TO RETRY
                                </motion.button>
                            )}
                            <motion.button className="btn-switch" onClick={logoutOperator} {...chipTap}>
                                <i className="fa-solid fa-right-from-bracket" /> Logout
                            </motion.button>
                        </div>
                    </motion.header>

                    <motion.main className="machine-container" variants={operatorPage} initial="initial" animate="animate">
                        <motion.div
                            className="machine-card"
                            initial={{ opacity: 0, y: 16, scale: 0.99 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.06 }}
                        >
                            <MachineCard
                                session={session}
                                activeHour={activeHour}
                                setActiveHour={setActiveHour}
                                onHourKeypad={handleHourKeypad}
                                totalActual={totalActual}
                                totalTarget={totalTarget}
                                efficiency={efficiency}
                                statusColor={statusColor}
                                onHourInput={handleHourInput}
                                onHourBlur={() => { }}
                                onOpenReasonModal={openReasonModal}
                                onSave={() => saveCurrentMachineData(false)}
                                onOpenClearConfirm={() => setClearConfirmOpen(true)}
                                syncBusy={syncBusy}
                            />
                        </motion.div>
                    </motion.main>
                </>
            )}

            <Toast message={toastMsg} visible={toastVisible} />
        </>
    );
}

// ======================================================================
// SELF-CONTAINED SKELETON LOADER
// ======================================================================

function DashboardSkeleton() {
    return (
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: "16px", fontFamily: "sans-serif" }}>
            <style>{`
                @keyframes skeleton-shimmer {
                    0% { background-position: -200px 0; }
                    100% { background-position: calc(200px + 100%) 0; }
                }
                .sk-pulse {
                    background: #e2e8f0;
                    background-image: linear-gradient(
                        90deg, 
                        #e2e8f0 0px, 
                        #f1f5f9 40px, 
                        #e2e8f0 80px
                    );
                    background-size: 200px 100%;
                    background-repeat: no-repeat;
                    animation: skeleton-shimmer 1.4s ease-in-out infinite;
                }
            `}</style>

            <header style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, width: "100%" }}>
                    <div className="sk-pulse" style={{flex: 1, height: 32, borderRadius: 8 }} />
                    <div className="sk-pulse" style={{ flex:1, height: 32, borderRadius: 8 }} />
                    <div className="sk-pulse" style={{ flex:1,  height: 32, borderRadius: 8 }} />
                </div>
            </header>

            <div style={{
                background: "#ffffff",
                borderRadius: 12,
                padding: 20,
                border: "1px solid #e2e8f0",
                boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05)",
                
            }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 , gap:10}}>
                    <div style={{ display: "flex",flex:1, flexDirection: "column", gap: 8 }}>
                        <div className="sk-pulse" style={{ flex:1, width: "100%", borderRadius: 6 }} />
                        <div className="sk-pulse" style={{ flex:1, width: "100%", borderRadius: 4 }} />
                    </div>
                    <div className="sk-pulse" style={{ flex:1, height: 24, borderRadius: 12 }} />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
                    {[1, 2, 3].map((i) => (
                        <div key={i} style={{
                            height: 70,
                            padding: 12,
                            borderRadius: 8,
                            border: "1px solid #f1f5f9",
                            background: "#fafafa",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "center",
                            alignItems: "center"
                        }}>
                            <div className="sk-pulse" style={{ width: "50%", height: 22, borderRadius: 4, marginBottom: 8 }} />
                            <div className="sk-pulse" style={{ width: "70%", height: 12, borderRadius: 4 }} />
                        </div>
                    ))}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((h) => (
                        <div key={h} style={{
                            height: 90,
                            padding: 12,
                            borderRadius: 8,
                            border: "1px solid #f1f5f9",
                            background: "#fafafa"
                        }}>
                            <div className="sk-pulse" style={{ width: "40%", height: 12, borderRadius: 4, marginBottom: 12 }} />
                            <div className="sk-pulse" style={{ width: "100%", height: 38, borderRadius: 6 }} />
                        </div>
                    ))}
                </div>

                <div className="sk-pulse" style={{ width: "100%", height: 48, borderRadius: 8 }} />
            </div>
        </div>
    );
}

// ======================================================================
// SUB-COMPONENTS
// ======================================================================

function LoginOverlay({
    dbMachines,
    dbParts,
    loginMachineId,
    loginPartName,
    onOpenMachineModal,
    onOpenPartModal,
    activeShift,
    username,
    setUsername,
    password,
    setPassword,
    loginError,
    loginBusy,
    onSubmit,
}) {
    return (
        <motion.div className="overlay-container" variants={overlayFade} initial="initial" animate="animate" exit="exit">
            <motion.div className="login-box" variants={modalPop} initial="initial" animate="animate" exit="exit">
                <i className="fa-solid fa-clipboard-list" style={{ fontSize: "2rem", color: "var(--navy)", marginBottom: 8 }} />
                <h2>LOGIN</h2>
                <p style={{ color: "var(--ink-dim)", fontSize: "0.85rem", fontWeight: 600 }}>
                    CITIC DICASTAL &mdash; PRODUCTION HOURS
                </p>

                <motion.div className="m-p-flex" variants={selectorRow} initial="initial" animate="animate">
                    <motion.div className="field-group-m" variants={selectorField}>
                        <label>MACHINE</label>
                        <motion.button
                            className="selector-btn"
                            onClick={onOpenMachineModal}
                            layout
                            whileHover={{
                                y: -3,
                                scale: 1.02,
                                boxShadow: "0 12px 24px rgba(22, 34, 63, 0.16)",
                                borderColor: "var(--brick)",
                            }}
                            whileTap={{ scale: 0.97, y: 0 }}
                            transition={{ type: "spring", stiffness: 420, damping: 26 }}
                        >
                            <motion.span
                                className="selector-icon"
                                animate={{ rotate: loginMachineId ? 0 : -12, scale: loginMachineId ? 1 : 0.94 }}
                                transition={{ type: "spring", stiffness: 320, damping: 20 }}
                            >
                                <i className="fa-solid fa-server" />
                            </motion.span>
                            <span className="selector-text">
                                <span className="sel-label">Machine SW</span>
                                <AnimatePresence mode="wait" initial={false}>
                                    <motion.span
                                        key={loginMachineId || "machine-placeholder"}
                                        className="sel-value"
                                        initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
                                        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                                        exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
                                        transition={{ duration: 0.2, ease: "easeOut" }}
                                    >
                                        {loginMachineId || "Select Machine..."}
                                    </motion.span>
                                </AnimatePresence>
                            </span>
                        </motion.button>
                    </motion.div>

                    <motion.div className="field-group-p" variants={selectorField}>
                        <label>PART</label>
                        <motion.button
                            className="selector-btn"
                            onClick={onOpenPartModal}
                            layout
                            whileHover={{
                                y: -3,
                                scale: 1.02,
                                boxShadow: "0 12px 24px rgba(22, 34, 63, 0.16)",
                                borderColor: "var(--brick)",
                            }}
                            whileTap={{ scale: 0.97, y: 0 }}
                            transition={{ type: "spring", stiffness: 420, damping: 26 }}
                        >
                            <motion.span
                                className="selector-icon"
                                animate={{ rotate: loginPartName ? 0 : -18, scale: loginPartName ? 1 : 0.94 }}
                                transition={{ type: "spring", stiffness: 320, damping: 20 }}
                            >
                                <i className="fa-solid fa-gear" />
                            </motion.span>
                            <span className="selector-text">
                                <span className="sel-label">Part</span>
                                <AnimatePresence mode="wait" initial={false}>
                                    <motion.span
                                        key={loginPartName || "part-placeholder"}
                                        className="sel-value"
                                        initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
                                        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                                        exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
                                        transition={{ duration: 0.2, ease: "easeOut" }}
                                    >
                                        {loginPartName || "Select Part..."}
                                    </motion.span>
                                </AnimatePresence>
                            </span>
                        </motion.button>
                    </motion.div>
                </motion.div>

                <div className="field-group">
                    <label>ACTIVE SHIFT · AUTOMATIC</label>
                    <div className="auto-shift">
                        <span className="auto-shift-team">{activeShift.shift}</span>
                        <span className="auto-shift-time">{activeShift.slot}</span>
                        <span className="auto-shift-day">Day {activeShift.workDay} of 6</span>
                    </div>
                </div>

                <div className="field-group">
                    <label htmlFor="usernameInput">MATRICULATION</label>
                    <input
                        type="tel"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        id="usernameInput"
                        className="input-field"
                        placeholder="Ex 611"
                        autoComplete="username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                    />
                </div>

                <div className="field-group">
                    <label htmlFor="passwordInput">PASSWORD</label>
                    <input
                        inputMode="numeric"
                        pattern="[0-9]*"
                        type="password"
                        id="passwordInput"
                        className="input-field"
                        placeholder="*****"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                    />
                </div>

                <AnimatePresence>
                    {loginError && (
                        <motion.div
                            className="error-msg"
                            style={{ display: "block" }}
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                        >
                            {loginError}
                        </motion.div>
                    )}
                </AnimatePresence>

                <motion.button className="btn-action" style={{ marginTop: 20 }} disabled={loginBusy} onClick={onSubmit} {...buttonTap}>
                    {loginBusy ? (
                        <>VERIFYING CREDENTIALS... <i className="fa-solid fa-spinner fa-spin" /></>
                    ) : (
                        <>START SHIFT <i className="fa-solid fa-bolt" /></>
                    )}
                </motion.button>
            </motion.div>
        </motion.div>
    );
}

function WelcomeModal({ info, onConfirm }) {
    return (
        <motion.div className="overlay-container" variants={overlayFade} initial="initial" animate="animate" exit="exit">
            <motion.div className="modal-box" style={{ textAlign: "center", maxWidth: 440 }} variants={modalPop} initial="initial" animate="animate" exit="exit">
                <motion.i
                    className="fa-solid fa-circle-check"
                    style={{ fontSize: "3rem", color: "var(--sage-ink)", marginBottom: 12, display: "inline-block" }}
                    initial={{ scale: 0, rotate: -30 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: "spring", stiffness: 400, damping: 18, delay: 0.05 }}
                />
                <h3 style={{ fontFamily: "var(--serif)", fontStyle: "italic", color: "var(--brick)", fontSize: "1.6rem" }}>Welcome!</h3>
                <p style={{ fontSize: "0.85rem", color: "var(--ink-dim)", fontWeight: 600, marginTop: 4 }}>Session verified successfully.</p>

                <div className="summary-list">
                    <div className="summary-item">
                        <label><i className="fa-solid fa-user" /> OPERATOR NAME</label>
                        <span>{info.operatorName}</span>
                    </div>
                    <div className="summary-item">
                        <label><i className="fa-solid fa-id-card" /> MATRICULATION</label>
                        <span>{info.matriculation}</span>
                    </div>
                    <div className="summary-item">
                        <label><i className="fa-solid fa-people-group" /> ASSIGNED SHIFT TEAM</label>
                        <span>{info.assignedShiftTeam || "Not assigned"}</span>
                    </div>
                    <div className="summary-item">
                        <label><i className="fa-solid fa-server" /> MACHINE</label>
                        <span>{info.machineId}</span>
                    </div>
                    <div className="summary-item">
                        <label><i className="fa-solid fa-gear" /> PART</label>
                        <span>{info.partName}</span>
                    </div>
                </div>

                {info.shiftWarning && (
                    <p
                        role="status"
                        style={{
                            background: "#fff4d6",
                            border: "1px solid #b8912b",
                            borderRadius: 10,
                            color: "#6b4f12",
                            fontSize: "0.82rem",
                            fontWeight: 600,
                            lineHeight: 1.5,
                            marginTop: 16,
                            padding: 12,
                        }}
                    >
                        <i className="fa-solid fa-triangle-exclamation" /> {info.shiftWarning}
                    </p>
                )}

                <motion.button className="btn-action" onClick={onConfirm} {...buttonTap}>
                    CONTINUE TO DASHBOARD <i className="fa-solid fa-arrow-right" />
                </motion.button>
            </motion.div>
        </motion.div>
    );
}

function ClearConfirmModal({ machineId, onConfirm, onCancel }) {
    return (
        <motion.div className="overlay-container" variants={overlayFade} initial="initial" animate="animate" exit="exit">
            <motion.div className="modal-box" style={{ textAlign: "center", maxWidth: 440 }} variants={modalPop} initial="initial" animate="animate" exit="exit">
                <i className="fa-solid fa-triangle-exclamation" style={{ fontSize: "3rem", color: "var(--brick)", marginBottom: 12 }} />
                <h3 style={{ fontFamily: "var(--serif)", fontStyle: "italic", color: "var(--brick)", fontSize: "1.5rem" }}>Clear Machine Data?</h3>
                <p style={{ fontSize: "0.85rem", color: "var(--ink-dim)", fontWeight: 600, marginTop: 8, lineHeight: 1.4 }}>
                    Are you sure you want to clear <strong>{machineId}</strong>'s saved hours? This action will permanently delete the entry from the database for this shift.
                </p>

                <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
                    <motion.button className="btn-danger-action" style={{ flex: 1 }} onClick={onConfirm} {...buttonTap}>
                        YES <i className="fa-solid fa-trash-can" />
                    </motion.button>
                    <motion.button className="btn-action" style={{ flex: 1, background: "var(--paper)", color: "var(--navy)" }} onClick={onCancel} {...buttonTap}>
                        CANCEL
                    </motion.button>
                </div>
            </motion.div>
        </motion.div>
    );
}

function MachineModal({ machines, currentId, onSelect, onClose }) {
    return (
        <motion.div className="overlay-container" variants={selectorOverlay} initial="initial" animate="animate" exit="exit">
            <motion.div className="modal-box" variants={selectorModal} initial="initial" animate="animate" exit="exit">
                <div className="modal-header">
                    <h3><i className="fa-solid fa-server" /> SELECT MACHINE</h3>
                    <motion.button className="close-btn" onClick={onClose} {...chipTap}><i className="fa-solid fa-xmark" /></motion.button>
                </div>
                <motion.div className="popup-grid" variants={selectorGrid} initial="initial" animate="animate">
                    {machines.length === 0
                        ? [1, 2, 3, 4].map((n) => (
                            <div key={n} className="popup-card" style={{ pointerEvents: "none" }}>
                                <div className="skeleton-box" style={{ height: 18, width: "70%" }} />
                            </div>
                        ))
                        : machines.map((m) => (
                            <motion.div
                                key={m.id}
                                className={`popup-card ${m.id === currentId ? "active" : ""}`}
                                onClick={() => onSelect(m.id)}
                                variants={selectorCard}
                                whileHover={{ y: -4, scale: 1.025, transition: { type: "spring", stiffness: 400, damping: 22 } }}
                                whileTap={{ scale: 0.97 }}
                            >
                                <AnimatePresence>
                                    {m.id === currentId && (
                                        <motion.span
                                            className="popup-card-selected"
                                            initial={{ opacity: 0, scale: 0.5, rotate: -45 }}
                                            animate={{ opacity: 1, scale: 1, rotate: 0 }}
                                            exit={{ opacity: 0, scale: 0.5, rotate: 45 }}
                                            transition={{ type: "spring", stiffness: 420, damping: 20 }}
                                            aria-hidden="true"
                                        >
                                            <i className="fa-solid fa-check" />
                                        </motion.span>
                                    )}
                                </AnimatePresence>
                                <div className="popup-card-title">{m.id}</div>
                            </motion.div>
                        ))}
                </motion.div>
            </motion.div>
        </motion.div>
    );
}

function PartModal({ parts, currentName, onSelect, onClose }) {
    return (
        <motion.div className="overlay-container" variants={selectorOverlay} initial="initial" animate="animate" exit="exit">
            <motion.div className="modal-box" variants={selectorModal} initial="initial" animate="animate" exit="exit" >
                <div className="modal-header">
                    <h3><i className="fa-solid fa-gear" /> SELECT PART</h3>
                    <motion.button className="close-btn" onClick={onClose} {...chipTap}><i className="fa-solid fa-xmark" /></motion.button>
                </div>
                <motion.div className="popup-grid popup-grid-parts" variants={selectorGrid} initial="initial" animate="animate">
                    {parts.length === 0
                        ? [1, 2, 3, 4].map((n) => (
                            <div key={n} className="popup-card" style={{ pointerEvents: "none", minHeight: 70 }}>
                                <div className="skeleton-box" style={{ height: 16, width: "70%", marginBottom: 8 }} />
                                <div className="skeleton-box" style={{ height: 12, width: "40%", marginBottom: 10 }} />
                                <div className="skeleton-box" style={{ height: 14, width: "50%" }} />
                            </div>
                        ))
                        : parts.map((p) => (
                            <motion.div
                                key={p.name}
                                className={`popup-card ${p.name === currentName ? "active" : ""}`}
                                onClick={() => onSelect(p.name, p.target)}
                                variants={selectorCard}
                                whileHover={{ y: -4, scale: 1.025, transition: { type: "spring", stiffness: 400, damping: 22 } }}
                                whileTap={{ scale: 0.97 }}
                            >
                                <AnimatePresence>
                                    {p.name === currentName && (
                                        <motion.span
                                            className="popup-card-selected"
                                            initial={{ opacity: 0, scale: 0.5, rotate: -45 }}
                                            animate={{ opacity: 1, scale: 1, rotate: 0 }}
                                            exit={{ opacity: 0, scale: 0.5, rotate: 45 }}
                                            transition={{ type: "spring", stiffness: 420, damping: 20 }}
                                            aria-hidden="true"
                                        >
                                            <i className="fa-solid fa-check" />
                                        </motion.span>
                                    )}
                                </AnimatePresence>
                                <div className="popup-card-title">{p.name}</div>
                                <div className="popup-card-sub">{p.code ? "SKU: " + p.code : ""}</div>
                                <span className="popup-card-tag"><i className="fa-solid fa-sliders" /> Target: {p.target}</span>
                            </motion.div>
                        ))}
                </motion.div>
            </motion.div>
        </motion.div>
    );
}

function ReasonModal({ hour, tempSelectedReason, onToggleReason, customNote, setCustomNote, onSave, onClose }) {
    return (
        <motion.div className="overlay-container" variants={overlayFade} initial="initial" animate="animate" exit="exit">
            <motion.div className="modal-box" variants={modalPop} initial="initial" animate="animate" exit="exit">
                <div className="modal-header">
                    <h3><i className="fa-solid fa-triangle-exclamation" /> DOWNTIME REASONS <span>{hour + 1}</span></h3>
                    <motion.button className="close-btn" onClick={onClose} {...chipTap}><i className="fa-solid fa-xmark" /></motion.button>
                </div>

                <div className="field-group" style={{ marginTop: 0, marginBottom: 16 }}>
                    <label>SELECT ALL THAT APPLY</label>
                </div>

                <motion.div className="popup-grid popup-grid-reasons" variants={gridContainer} initial="initial" animate="animate">
                    {REASON_PRESETS.map((r) => (
                        <motion.div
                            key={r.id}
                            className={`popup-card reason-choice ${tempSelectedReason.includes(r.id) ? "active" : ""}`}
                            role="button"
                            tabIndex={0}
                            aria-pressed={tempSelectedReason.includes(r.id)}
                            onClick={() => onToggleReason(r.id)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    onToggleReason(r.id);
                                }
                            }}
                            variants={gridItem}
                            whileHover={{ y: -3 }}
                            whileTap={{ scale: 0.96 }}
                        >
                            <i className={`fa-solid ${r.icon}`} style={{ fontSize: "1.4rem", marginBottom: 6, color: "var(--brick)" }} />
                            <div className="popup-card-title">{r.label}</div>
                            {tempSelectedReason.includes(r.id) && (
                                <span className="popup-card-selected" aria-hidden="true">
                                    <i className="fa-solid fa-check" />
                                </span>
                            )}
                        </motion.div>
                    ))}
                </motion.div>

                <div className="field-group" style={{ marginTop: 20 }}>
                    <label htmlFor="customNoteInput">OPTIONAL NOTES / REMARKS</label>
                    <input
                        type="text"
                        id="customNoteInput"
                        className="input-field"
                        placeholder="e.g. Spindle overheating, line stoppage..."
                        autoComplete="off"
                        value={customNote}
                        onChange={(e) => setCustomNote(e.target.value)}
                    />
                </div>

                <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
                    <motion.button className="btn-action" style={{ flex: 2, fontSize: "0.85rem", padding: 12 }} onClick={onSave} {...buttonTap}>
                        SAVE REASONS <i className="fa-solid fa-check" />
                    </motion.button>
                    <motion.button className="btn-danger-outline" style={{ flex: 1, marginTop: 0, fontSize: "0.75rem", padding: 12 }} onClick={onClose} {...buttonTap}>
                        CANCEL
                    </motion.button>
                </div>
            </motion.div>
        </motion.div>
    );
}

function MachineCard({
    session,
    activeHour,
    setActiveHour,
    onHourKeypad,
    totalActual,
    totalTarget,
    efficiency,
    statusColor,
    onHourInput,
    onOpenReasonModal,
    onSave,
    onOpenClearConfirm,
    syncBusy,
}) {
    return (
        <>
            <div className="card-header">
                <div>
                    <div className="machine-id">{session.machineId}</div>
                    <div className="card-header-target">
                        <span>TARGET: {session.target}/HR</span>
                    </div>
                </div>
                <div className="part-name-display"><i className="fa-solid fa-gear" /> {session.partName}</div>
            </div>

            <div className="metrics-row">
                <div className="metric-box">
                    <AnimatedNumber className="metric-val" style={{ color: "var(--neon-cyan)" }} value={totalActual} />
                    <div className="metric-label">Actual Produced</div>
                </div>
                <div className="metric-box">
                    <div className="metric-val">{totalTarget}</div>
                    <div className="metric-label">Shift Target</div>
                </div>
                <div className="metric-box">
                    <AnimatedNumber className="metric-val" style={{ color: statusColor }} value={efficiency} suffix="%" />
                    <div className="metric-label">Efficiency (OEE)</div>
                </div>
            </div>

            <motion.div
                className="hour-entry-layout"
                layout
            >
                <motion.div className="hours-grid" variants={gridContainer} initial="initial" animate="animate">
                    {session.hours.map((val, h) => {
                        const belowTarget = Number(val) < session.target;
                        const currentReasons = normalizeReasons(session.reasons[h]);
                        const currentReason = currentReasons.join(", ");
                        const hasReason = Boolean(currentReason);
                        return (
                            <motion.div
                                key={h}
                                layout
                                initial={{ opacity: 0, y: 10, scale: 0.985 }}
                                className={`hour-pill ${belowTarget ? "below-target" : "target-met"} ${activeHour === h ? "hour-pill-active" : ""}`}
                                animate={{
                                    opacity: 1,
                                    backgroundColor: belowTarget ? "#faf6ec" : "#cfe6cf",
                                    borderColor: activeHour === h
                                        ? "#b23a2e"
                                        : belowTarget
                                            ? "rgba(143, 50, 38, 0.35)"
                                            : "rgba(43, 94, 58, 0.4)",
                                    boxShadow: activeHour === h
                                        ? "0 0 0 3px rgba(178, 58, 46, 0.1), 0 8px 22px rgba(22, 34, 63, 0.1)"
                                        : "0 5px 16px rgba(22, 34, 63, 0.07)",
                                    scale: activeHour === h ? 1.015 : 1,
                                }}
                                whileHover={{ y: activeHour === h ? 0 : -2 }}
                                transition={{
                                    backgroundColor: { duration: 0.35, ease: "easeOut" },
                                    borderColor: { duration: 0.25, ease: "easeOut" },
                                    boxShadow: { duration: 0.25, ease: "easeOut" },
                                    opacity: { duration: 0.24, delay: h * 0.035 },
                                    y: { type: "spring", stiffness: 320, damping: 28, delay: h * 0.035 },
                                    scale: { type: "spring", stiffness: 360, damping: 28 },
                                }}
                            >
                                <motion.span
                                    className="hour-state-rail"
                                    animate={{
                                        backgroundColor: activeHour === h ? "#b23a2e" : belowTarget ? "#8f3226" : "#2b5e3a",
                                        opacity: activeHour === h ? 1 : 0.85,
                                    }}
                                    transition={{ duration: 0.25, ease: "easeOut" }}
                                    aria-hidden="true"
                                />
                                <div className="hour-pill-header">
                                    <label htmlFor={`hour-input-${h}`}>HOUR {h + 1}</label>
                                    <span className="hour-target-label">Target: {session.target}</span>
                                </div>
                                <motion.input
                                    id={`hour-input-${h}`}
                                    className={`hour-count-input ${belowTarget ? "below-target" : "target-met"}`}
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    maxLength={2}
                                    autoComplete="off"
                                    data-hour={h}
                                    aria-label={`Production count for hour ${h + 1}`}
                                    placeholder="0"
                                    value={Number(val) === 0 ? "" : val}
                                    onFocus={() => setActiveHour(h)}
                                    onChange={(e) => onHourInput(h, e.target.value)}
                                    whileFocus={{ scale: 1.015 }}
                                    transition={{ type: "spring", stiffness: 360, damping: 26 }}
                                />
                                <div className="reason-wrap" style={{ overflow: "hidden" }}>
                                    <AnimatePresence initial={false}>
                                        {belowTarget && (
                                            <motion.button
                                                key="reason-btn"
                                                type="button"
                                                className={`reason-btn ${hasReason ? "has-reason" : ""}`}
                                                aria-label={hasReason ? `Selected reasons: ${currentReason}` : `Select a reason for hour ${h + 1}`}
                                                title={hasReason ? currentReason : undefined}
                                                onClick={() => onOpenReasonModal(h)}
                                                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                                                animate={{ opacity: 1, height: "auto", marginTop: 8 }}
                                                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                                                transition={{ duration: 0.2, ease: "easeInOut" }}
                                                whileTap={{ scale: 0.95 }}
                                            >
                                                <i className={`fa-solid ${hasReason ? "fa-pen-to-square" : "fa-triangle-exclamation"}`} />{" "}
                                                <span className="reason-btn-label">
                                                    {hasReason ? currentReason : "Select reason"}
                                                </span>
                                            </motion.button>
                                        )}
                                        {!belowTarget && (
                                            <motion.div
                                                key="target-good"
                                                className="hour-good"
                                                role="status"
                                                aria-label={`Good, target reached for hour ${h + 1}`}
                                                initial={{ opacity: 0, height: 0, marginTop: 0, backgroundColor: "#e8f4e8" }}
                                                animate={{ opacity: 1, height: "auto", marginTop: 8, backgroundColor: "#cfe6cf" }}
                                                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                                                transition={{ duration: 0.24, ease: "easeInOut" }}
                                            >
                                                <i className="fa-solid fa-circle-check" aria-hidden="true" />
                                                <span>Good</span>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </motion.div>
                        );
                    })}
                </motion.div>
                <AnimatePresence>
                    {activeHour !== null && (
                        <motion.div
                            className="hour-keypad"
                            initial={{ opacity: 0, x: 16, scale: 0.96 }}
                            animate={{ opacity: 1, x: 0, scale: 1 }}
                            exit={{ opacity: 0, x: 12, scale: 0.97 }}
                            transition={{ type: "spring", stiffness: 360, damping: 28 }}
                            aria-label={`Number pad for hour ${activeHour + 1}`}
                        >
                            <div className="hour-keypad-heading">
                                <span>NUMBER PAD</span>
                                <strong>HOUR {activeHour + 1}</strong>
                            </div>
                            <div className="hour-keypad-grid">
                                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "backspace"].map((key) => (
                                    <motion.button
                                        key={key}
                                        type="button"
                                        className={`hour-key ${key === "clear" || key === "backspace" ? "hour-key-action" : ""}`}
                                        aria-label={key === "clear" ? "Clear value" : key === "backspace" ? "Delete last digit" : `Enter ${key}`}
                                        onPointerDown={(event) => event.preventDefault()}
                                        onClick={() => onHourKeypad(key)}
                                        whileHover={{ y: -2, boxShadow: "0 5px 0 var(--navy-soft)" }}
                                        whileTap={{ scale: 0.93, y: 1 }}
                                        transition={{ type: "spring", stiffness: 420, damping: 24 }}
                                    >
                                        {key === "clear" ? "C" : key === "backspace" ? <i className="fa-solid fa-delete-left" /> : key}
                                    </motion.button>
                                ))}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>

            <motion.button className="btn-action btn-save-data" onClick={onSave} disabled={syncBusy} style={{ opacity: syncBusy ? 0.7 : 1 }} {...buttonTap}>
                {syncBusy ? (
                    <>SAVING... <i className="fa-solid fa-spinner fa-spin" /></>
                ) : (
                    <>SAVE DATA<i className="fa-solid fa-cloud-arrow-up" /></>
                )}
            </motion.button>
            <motion.button className="btn-danger-outline" onClick={onOpenClearConfirm} {...chipTap}>
                <i className="fa-solid fa-trash-can" /> CLEAR FOR NEXT SHIFT
            </motion.button>
        </>
    );
}
