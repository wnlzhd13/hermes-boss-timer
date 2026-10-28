
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";
import { supabase } from "./supabase";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string;


function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const rawData = window.atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(rawData.length));

  for (let i = 0; i < rawData.length; i++) {
    bytes[i] = rawData.charCodeAt(i);
  }

  return bytes;
}


if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        console.log("서비스 워커 등록 완료", registration);
      })
      .catch((error) => {
        console.error("서비스 워커 등록 실패", error);
      });
  });
}

type BossType = "daily" | "weekly";
type FilterType = "all" | BossType;


type Member = {
  id: string;
  display_name: string;
  role: "member" | "admin";
  approved: boolean;
  created_at: string;
};

type Boss = {
  id: string;
  name: string;
  grade: string;
  location: string;
  type: BossType;
  firstSpawnAt: number;
  nextSpawnAt: number;
  respawnHours: number;
  cutAt?: number;
  cutCount: number;
};

type BossForm = {
  name: string;
  grade: string;
  location: string;
  type: BossType;
  firstSpawnAt: string;
  respawnHours: string;
  remainingHours: string;
  remainingMinutes: string;
};

function bossFromDatabase(row: any): Boss {
  return {
    id: row.id,
    name: row.name,
    grade: row.grade,
    location: row.location,
    type: row.boss_type,
    firstSpawnAt: (row.first_spawn_at ?? row.flrst_spawn_at)
    ? new Date(row.first_spawn_at ?? row.flrst_spawn_at).getTime()
    : 0,
    nextSpawnAt: row.next_spawn_at
      ? new Date(row.next_spawn_at).getTime()
      : 0,
    respawnHours: Number(row.respawn_hours),
    cutAt: row.last_killed_at
      ? new Date(row.last_killed_at).getTime()
      : undefined,
    cutCount: row.cut_count ?? 0,
  };
}

const STORAGE_KEY = "hermes-boss-timer-v3";
const FIVE_MINUTES = 5 * 60 * 1000;
const THREE_MINUTES = 1 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function localDateTimeValue(timestamp: number): string {
  const offset = new Date(timestamp).getTimezoneOffset() * 60_000;
  return new Date(timestamp - offset).toISOString().slice(0, 16);
}

function createEmptyForm(): BossForm {
  return {
    name: "",
    grade: "보스",
    location: "",
    type: "daily",
    firstSpawnAt: localDateTimeValue(Date.now() + 60 * 60 * 1000),
    respawnHours: "6",
    remainingHours: "1",
    remainingMinutes: "0",
  };
}

function loadBosses(): Boss[] {
  return [];
}


function formatSpawnTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatCountdown(target: number, now: number): string {
  const remaining = target - now;
  if (remaining <= 0) return "출현 시간 경과";

  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}일 ${hours}시간 ${minutes}분`;

  return [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    String(seconds).padStart(2, "0"),
  ].join(":");
}

function nextWeeklySpawn(scheduledSpawn: number, now: number): number {
  if (scheduledSpawn > now) return scheduledSpawn;

  const weeksPassed = Math.floor((now - scheduledSpawn) / WEEK_MS) + 1;
  return scheduledSpawn + weeksPassed * WEEK_MS;
}

type EditorProps = {
  form: BossForm;
  setForm: (form: BossForm) => void;
  editing: boolean;
  error: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
};

function BossEditor({
  form,
  setForm,
  editing,
  error,
  onSubmit,
  onCancel,
}: EditorProps) {
  return (
    <section className="form-card">
      <div className="form-heading">
        <div>
          <h2>{editing ? "보스 수정" : "새 보스 등록"}</h2>
          <p>
            {editing
              ? "남은 출현 시간을 입력하면 현재 시각 기준으로 출현 시각이 변경됩니다."
              : "최초 출현 날짜와 시간을 설정하세요."}
          </p>
        </div>
        <button
          className="close-button"
          type="button"
          onClick={onCancel}
          aria-label="닫기"
        >
          ×
        </button>
      </div>

      <form onSubmit={onSubmit}>
        <div className="form-grid">
          <label>
            보스 이름
            <input
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
              placeholder="보스 이름"
              required
            />
          </label>

          <label>
            보스 등급
            <select
              value={form.grade}
              onChange={(event) =>
                setForm({ ...form, grade: event.target.value })
              }
            >
              <option>일반</option>
              <option>정예</option>
              <option>보스</option>
              <option>월드 보스</option>
            </select>
          </label>

          <fieldset className="full-width type-fieldset">
            <legend>출현 유형</legend>

            <label className="radio-option">
              <input
                type="radio"
                name="bossType"
                checked={form.type === "daily"}
                onChange={() => setForm({ ...form, type: "daily" })}
              />
              <span>
                <strong>일일 보스</strong>
                <small>컷 시간부터 설정된 재출현 주기를 계산합니다.</small>
              </span>
            </label>

            <label className="radio-option">
              <input
                type="radio"
                name="bossType"
                checked={form.type === "weekly"}
                onChange={() => setForm({ ...form, type: "weekly" })}
              />
              <span>
                <strong>주간 보스</strong>
                <small>설정한 출현 시각을 기준으로 주간 일정을 계산합니다.</small>
              </span>
            </label>
          </fieldset>

          {editing ? (
            <div className="full-width remaining-time-fields">
              <span className="field-title">남은 출현 시간</span>
              <div className="remaining-time-inputs">
                <label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.remainingHours}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        remainingHours: event.target.value,
                      })
                    }
                    required
                  />
                  <span>시간</span>
                </label>

                <label>
                  <input
                    type="number"
                    min="0"
                    max="59"
                    step="1"
                    value={form.remainingMinutes}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        remainingMinutes: event.target.value,
                      })
                    }
                    required
                  />
                  <span>분</span>
                </label>
              </div>
              <small>
                예: 2시간 30분 입력 후 저장하면 지금부터 2시간 30분 뒤로
                출현 시각이 변경됩니다.
              </small>
            </div>
          ) : (
            <label className="full-width">
              최초 출현 날짜 및 시간
              <input
                type="datetime-local"
                value={form.firstSpawnAt}
                onChange={(event) =>
                  setForm({ ...form, firstSpawnAt: event.target.value })
                }
                required
              />
            </label>
          )}

          {form.type === "daily" && (
            <label className="full-width">
              컷 후 재출현 주기 (시간)
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={form.respawnHours}
                onChange={(event) =>
                  setForm({ ...form, respawnHours: event.target.value })
                }
                required
              />
            </label>
          )}

          {form.type === "weekly" && (
            <div className="schedule-note full-width">
              주간 보스도 수정 화면에서 남은 출현 시간을 지정할 수 있습니다.
              컷 기록 후에는 변경된 출현 시각을 기준으로 다음 주 일정을
              계산합니다.
            </div>
          )}
        </div>

        {error && <p className="form-error">{error}</p>}

        <div className="form-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onCancel}
          >
            취소
          </button>
          <button type="submit" className="primary-button">
            {editing ? "출현 시간 변경 저장" : "보스 등록"}
          </button>
        </div>
      </form>
    </section>
  );
}


export default function App() {

  const [installPrompt, setInstallPrompt] = useState<any>(null);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };

    window.addEventListener(
      "beforeinstallprompt",
      handleBeforeInstallPrompt
    );

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt
      );
    };
  }, []);


async function handleAddToHomeScreen() {
  if (installPrompt) {
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;

    if (choice?.outcome === "accepted") {
      alert("앱 설치가 시작되었습니다.");
      setInstallPrompt(null);
    }

    return;
  }

  if (window.matchMedia("(display-mode: standalone)").matches) {
    alert("이미 앱이 설치되어 있습니다.");
    return;
  }

  alert(
    "현재 브라우저에서 바로 설치할 수 없습니다. " +
    "안드로이드에서는 Chrome으로 앱 사이트를 열어 다시 시도해 주세요."
  );
}

  
    useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      console.warn("이 브라우저는 서비스 워커를 지원하지 않습니다.");
      return;
    }

    navigator.serviceWorker
      .register("/sw.js")
      .then(() => {
        console.log("푸시 알림 서비스 워커 등록 완료");
      })
      .catch((error) => {
        console.error("서비스 워커 등록 실패:", error);
      });
  }, []);
  
  const [bosses, setBosses] = useState<Boss[]>(loadBosses);
  const [alarmEnabled, setAlarmEnabled] = useState(false);
  const notifiedBosses = useRef<Set<string>>(new Set());
  const autoCutProcessed = useRef<Set<string>>(new Set());
  const [sessionChecked, setSessionChecked] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [nickname, setNickname] = useState("");
  const [now, setNow] = useState(Date.now());
  const [filter, setFilter] = useState<FilterType>("all");
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminMode, setAdminMode] = useState(false);
  const [memberManagementOpen, setMemberManagementOpen] = useState(false);
  const [approved, setApproved] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
const [membersLoading, setMembersLoading] = useState(false);
const [membersError, setMembersError] = useState("");

  const handleMemberApproval = async (member: Member) => {
  const { data: userData } = await supabase.auth.getUser();

  if (userData.user?.id === member.id) {
    alert("현재 로그인한 계정의 승인 상태는 변경할 수 없습니다.");
    return;
  }

  const newApproved = !member.approved;

  const { error } = await supabase
    .from("profiles")
    .update({ approved: newApproved })
    .eq("id", member.id);

  if (error) {
    alert("승인 상태 변경에 실패했습니다: " + error.message);
    return;
  }

  setMembers((currentMembers) =>
    currentMembers.map((item) =>
      item.id === member.id
        ? { ...item, approved: newApproved }
        : item
    )
  );

  alert(
    newApproved
      ? "회원 승인이 완료되었습니다."
      : "회원 승인이 취소되었습니다."
  );
};

  const handleMemberRoleChange = async (member: Member) => {
  const newRole = member.role === "admin" ? "member" : "admin";
  const actionText = newRole === "admin" ? "관리자 등록" : "일반 회원 변경";

  if (!window.confirm(`${member.display_name || "이 회원"}님을 ${actionText}하시겠습니까?`)) {
    return;
  }

  const { error } = await supabase
    .from("profiles")
    .update({ role: newRole })
    .eq("id", member.id);

  if (error) {
    alert("권한 변경에 실패했습니다: " + error.message);
    return;
  }

  setMembers((currentMembers) =>
    currentMembers.map((item) =>
      item.id === member.id ? { ...item, role: newRole } : item
    )
  );

  alert(newRole === "admin" ? "관리자로 등록했습니다." : "일반 회원으로 변경했습니다.");
};
  
  useEffect(() => {
  if (!sessionChecked || !loggedIn || !isAdmin) {
    setMembers([]);
    return;
  }

  let cancelled = false;

  const fetchMembers = async () => {
    setMembersLoading(true);
    setMembersError("");

    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, role, approved, created_at")
      .order("created_at", { ascending: false });

    if (cancelled) return;

    if (error) {
      setMembersError("회원 목록을 불러오지 못했습니다: " + error.message);
      setMembers([]);
    } else {
      setMembers((data ?? []) as Member[]);
    }

    setMembersLoading(false);
  };

  fetchMembers();

  return () => {
    cancelled = true;
  };
}, [sessionChecked, loggedIn, isAdmin]);
  
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BossForm>(createEmptyForm);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let active = true;

    async function checkSession() {
      const { data, error } = await supabase.auth.getSession();

      if (!active) return;

   if (error || !data.session) {
  setLoggedIn(false);
  setIsAdmin(false);
  setApproved(false);
  setNickname("");
  setSessionChecked(true);
  return;
}

      setLoggedIn(true);
      setNickname(data.session.user.email ?? "");

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role, approved, display_name")
        .eq("id", data.session.user.id)
        .single();

      if (!active) return;

      setIsAdmin(
        !profileError &&
          profile?.role === "admin" &&
          profile?.approved === true
      );
      
if (!profileError && profile?.display_name) {
  setNickname(profile.display_name);
}
    
      setApproved(!profileError && profile?.approved === true);
      setSessionChecked(true);
    }

    checkSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;

      setLoggedIn(!!session);

      if (!session) {
        setIsAdmin(false);
        setApproved(false);
        setSessionChecked(true);
      } else {
        checkSession();
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

    useEffect(() => {
    if (!alarmEnabled) return;

    const checkAlarm = () => {
      const currentTime = Date.now();

      bosses.forEach((boss) => {
        const remaining = boss.nextSpawnAt - currentTime;
        const notificationKey = `${boss.id}-${boss.nextSpawnAt}`;

        if (
          remaining > 0 &&
          remaining <= FIVE_MINUTES &&
          !notifiedBosses.current.has(notificationKey)
        ) {
          notifiedBosses.current.add(notificationKey);


if (
  "Notification" in window &&
  Notification.permission === "granted" &&
  "serviceWorker" in navigator
) {
  navigator.serviceWorker.ready
    .then((registration) => {
      return registration.showNotification(
        `${boss.name} 출현 5분 전!`,
        {
          body: `${boss.name} 보스가 곧 출현합니다.`,
          icon: "/icon-192.png",
          tag: notificationKey,
          data: { url: "/" },
        }
      );
    })
    .catch((error) => {
      console.error("보스 알림 표시 실패:", error);
    });
}


          try {
            const audioContext = new AudioContext();
            const oscillator = audioContext.createOscillator();
            const gain = audioContext.createGain();

            oscillator.connect(gain);
            gain.connect(audioContext.destination);
            oscillator.frequency.value = 880;
            gain.gain.value = 0.2;

            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.6);
            oscillator.onended = () => {
              void audioContext.close();
            };
          } catch (error) {
            console.error("알림음 재생 실패:", error);
          }
        }
      });
    };

    checkAlarm();
    const timer = window.setInterval(checkAlarm, 1000);

    return () => window.clearInterval(timer);
  }, [alarmEnabled, bosses]);

useEffect(() => {
  if (!sessionChecked) return;

  async function fetchBosses() {
    const { data, error } = await supabase
      .from("bosses")
      .select("*");

    if (error) {
      console.error("보스 목록 불러오기 실패:", error.message);
      return;
    }

    if (data) {
      setBosses(data.map((row) => bossFromDatabase(row)));
    }
  }

  fetchBosses();
}, [sessionChecked]);

  
  useEffect(() => {
    if (!sessionChecked) return;

    const channel = supabase
      .channel("bosses-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bosses",
        },
        async () => {
          const { data, error } = await supabase
            .from("bosses")
            .select("*");

          if (error) {
            console.error("보스 실시간 갱신 실패:", error.message);
            return;
          }

          if (data) {
            setBosses(data.map((row) => bossFromDatabase(row)));
            setNow(Date.now());
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionChecked, loggedIn, approved]);



  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bosses));
    } catch {
      // 저장 공간 오류가 발생해도 현재 화면은 계속 표시합니다.
    }
  }, [bosses]);

  const visibleBosses = useMemo(
    () =>
      bosses
        
.filter((boss) =>
  filter === "all"
    ? boss.nextSpawnAt - now < 24 * 60 * 60 * 1000
    : boss.type === filter
)

        .sort((a, b) => a.nextSpawnAt - b.nextSpawnAt),
    [bosses, filter]
  );

  const nextBossId = visibleBosses[0]?.id;

  function openAddForm() {
    setEditingId(null);
    setForm(createEmptyForm());
    setFormError("");
    setFormOpen(true);
  }

  function openEditForm(boss: Boss) {
    const remainingMs = Math.max(0, boss.nextSpawnAt - Date.now());
    const totalMinutes = Math.ceil(remainingMs / 60_000);

    setEditingId(boss.id);
    setForm({
      name: boss.name,
      grade: boss.grade,
      location: boss.location,
      type: boss.type,
      firstSpawnAt: localDateTimeValue(boss.firstSpawnAt),
      respawnHours: String(boss.respawnHours),
      remainingHours: String(Math.floor(totalMinutes / 60)),
      remainingMinutes: String(totalMinutes % 60),
    });
    setFormError("");
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setFormError("");
  }

  async function saveBoss(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const name = form.name.trim();
    const location = form.location.trim();
    const respawnHours = Number(form.respawnHours);

    if (!name) {
      setFormError("보스 이름을 입력해 주세요.");
      return;
    }

    if (
      form.type === "daily" &&
      (!Number.isFinite(respawnHours) || respawnHours <= 0)
    ) {
      setFormError("컷 후 재출현 주기는 0보다 큰 시간으로 입력해 주세요.");
      return;
    }

    if (editingId) {
      const hours = Number(form.remainingHours);
      const minutes = Number(form.remainingMinutes);

      if (
        !Number.isFinite(hours) ||
        !Number.isFinite(minutes) ||
        !Number.isInteger(hours) ||
        !Number.isInteger(minutes) ||
        hours < 0 ||
        minutes < 0 ||
        minutes > 59 ||
        hours + minutes === 0
      ) {
        setFormError(
          "남은 출현 시간을 입력해 주세요. 분은 0~59, 전체 시간은 0보다 커야 합니다."
        );
        return;
      }
      const newNextSpawnAt =
      Date.now() + (hours * 60 + minutes) * 60_000;
      
      const { error } = await supabase
        .from("bosses")
        .update({
          name,
          grade: form.grade,
          location,
          boss_type: form.type,
          respawn_hours: form.type === "daily" ? respawnHours : 168,
          next_spawn_at: new Date(newNextSpawnAt).toISOString(),
          last_killed_at: null,
        })
        .eq("id", editingId);

      if (error) {
        setFormError("보스 수정 실패: " + error.message);
        return;
      }

      setBosses((current) =>
        current.map((boss) =>
          boss.id === editingId
            ? {
                ...boss,
                name,
                grade: form.grade,
                location,
                type: form.type,
                respawnHours: form.type === "daily" ? respawnHours : 168,
                nextSpawnAt: newNextSpawnAt,
                cutAt: undefined,
              }
            : boss
        )
      );
    } else {
      const firstSpawnAt = new Date(form.firstSpawnAt).getTime();

      if (!Number.isFinite(firstSpawnAt)) {
        setFormError("올바른 최초 출현 날짜와 시간을 입력해 주세요.");
        return;
      }

      const { data, error } = await supabase
        .from("bosses")
        .insert({
          name,
          grade: form.grade,
          location,
          boss_type: form.type,
          first_spawn_at: new Date(firstSpawnAt).toISOString(),
          next_spawn_at: new Date(firstSpawnAt).toISOString(),
          respawn_hours: form.type === "daily" ? respawnHours : 168,
          cut_count: 0,
        })
        .select()
        .single();

      if (error) {
        setFormError("보스 추가 실패: " + error.message);
        return;
      }

      setBosses((current) => [...current, bossFromDatabase(data)]);
    }

    closeForm();
    setNow(Date.now());
  }

  async function deleteBoss(boss: Boss) {
    if (
      !window.confirm(
        `"${boss.name}" 보스를 삭제할까요?\n이 보스의 컷 기록도 함께 삭제됩니다.`
      )
    ) {
      return;
    }

    const { error } = await supabase
      .from("bosses")
      .delete()
      .eq("id", boss.id);

    if (error) {
      window.alert("보스 삭제 실패: " + error.message);
      return;
    }

    setBosses((current) =>
      current.filter((item) => item.id !== boss.id)
    );

    if (editingId === boss.id) closeForm();
  }

  async function recordCut(bossId: string) {
    const cutTime = Date.now();
    const boss = bosses.find((item) => item.id === bossId);

    if (!boss) return;

    const nextSpawnAt =
      boss.type === "daily"
        ? cutTime + boss.respawnHours * 60 * 60 * 1000
        : nextWeeklySpawn(boss.nextSpawnAt, cutTime);

    const { error } = await supabase
      .from("bosses")
      .update({
        last_killed_at: new Date(cutTime).toISOString(),
        next_spawn_at: new Date(nextSpawnAt).toISOString(),
        cut_count: boss.cutCount + 1,
      })
      .eq("id", bossId);

    if (error) {
      window.alert("컷 기록 저장 실패: " + error.message);
      return;
    }

    setBosses((current) =>
      current.map((item) =>
        item.id === bossId
          ? {
              ...item,
              cutAt: cutTime,
              cutCount: item.cutCount + 1,
              nextSpawnAt,
            }
          : item
      )
    );

    setNow(cutTime);
  }

    useEffect(() => {
    if (!sessionChecked || !loggedIn || !approved || !isAdmin) {
      return;
    }

    const checkAutoCut = () => {
      const currentTime = Date.now();

      bosses.forEach((boss) => {
        const spawnTime = boss.nextSpawnAt;

// 출현 예정 시각으로부터 3분이 지났는지 확인
if (currentTime < spawnTime + THREE_MINUTES) {
  return;
}

        // 같은 출현 일정의 중복 컷 방지
        const key = `${boss.id}-${spawnTime}`;

        if (autoCutProcessed.current.has(key)) {
          return;
        }

        autoCutProcessed.current.add(key);

        void recordCut(boss.id).catch((error) => {
          console.error("자동 컷 처리 실패:", error);
          autoCutProcessed.current.delete(key);
        });
      });
    };

    checkAutoCut();

    const timer = window.setInterval(checkAutoCut, 1000);

    return () => window.clearInterval(timer);
  }, [sessionChecked, loggedIn, approved, isAdmin, bosses]);

if (!sessionChecked) {
  return <p>화면을 불러오는 중...</p>;
}

if (!loggedIn && !sessionChecked) {
  return <p>로그인 상태 확인 중...</p>;
}

const isMembersPage =
  new URLSearchParams(window.location.search).get("page") === "members";

if (isMembersPage) {
  if (!sessionChecked) {
    return <main className="app">로그인 상태 확인 중...</main>;
  }

  if (!loggedIn || !isAdmin) {
    return <main className="app">관리자만 접근할 수 있습니다.</main>;
  }

  return (
    <main className="app">
      <section className="admin-panel members-page">
        <button
  type="button"
  className="primary-button"
  onClick={() => {
    window.location.href = window.location.pathname;
  }}
>
  ← 보스 타임으로 돌아가기
</button>
        <div>
          <h2>회원 관리</h2>
          <p>회원 명단 및 승인 관리</p>
        </div>

        {membersLoading && <p>회원 목록을 불러오는 중입니다...</p>}
        {membersError && <p>{membersError}</p>}

        {!membersLoading && !membersError &&
          members.map((member) => (
           <div key={member.id} className="member-card">
              <p>이름: {member.display_name || "이름 없음"}</p>
              <p>권한: {member.role === "admin" ? "관리자" : "일반 회원"}</p>
              <p>승인 상태: {member.approved ? "승인됨" : "승인 대기"}</p>

              <button
                className="primary-button"
                onClick={() => handleMemberApproval(member)}
              >
                {member.approved ? "승인 취소" : "회원 승인"}
              </button>
              <button
  className="primary-button"
  onClick={() => handleMemberRoleChange(member)}
>
  {member.role === "admin" ? "일반 회원으로 변경" : "관리자 등록"}
</button>
            </div>
          ))}
      </section>
    </main>
  );
}
  
  return (
    <main className="app">
      <header className="app-header">
<div className="brand">
  <div className="brand-title-row">
    <div className="brand-title-text">
      <h1>헤르메스 3서버 보스타임</h1>
      <p className="subtitle">길드 에르메스</p>
    </div>

    <button
      type="button"
      className="home-install-button"
      onClick={handleAddToHomeScreen}
    >
      <span aria-hidden="true">＋</span>
      어플 설치
    </button>
  </div>
</div>
  
<div className="header-actions">
  <span className="developer-credit">개발자 : 쩜샷</span>

  {loggedIn && nickname && (
    <span className="user-nickname">
      로그인: {nickname}
    </span>
  )}

  
<button
  type="button"
  className="primary-button"
  onClick={async () => {
    if (alarmEnabled) {
      setAlarmEnabled(false);
      localStorage.setItem("hermes-alarm-enabled", "false");
      return;
    }

    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        alert("이 브라우저는 푸시 알림을 지원하지 않습니다.");
        return;
      }

      if (!("Notification" in window)) {
        alert("이 브라우저는 알림을 지원하지 않습니다.");
        return;
      }

      if (!VAPID_PUBLIC_KEY) {
        alert("VAPID 공개키 설정을 확인해 주세요.");
        return;
      }

      if (Notification.permission === "denied") {
        alert("브라우저 설정에서 사이트 알림을 허용해 주세요.");
        return;
      }

      const permission =
        Notification.permission === "granted"
          ? "granted"
          : await Notification.requestPermission();

      if (permission !== "granted") {
        alert("브라우저 설정에서 알림을 허용해 주세요.");
        return;
      }

const userData = { user: null };

      const registration = await navigator.serviceWorker.ready;

      let subscription =
        await registration.pushManager.getSubscription();

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey:
            urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }

      const { error } = await supabase
        .from("push_subscriptions")
        .upsert(
          {
            user_id: null,
            endpoint: subscription.endpoint,
            subscription: subscription.toJSON(),
          },
          { onConflict: "endpoint" }
        );

      if (error) {
        throw error;
      }

      setAlarmEnabled(true);
      localStorage.setItem("hermes-alarm-enabled", "true");

      alert("푸시 알림 설정이 완료되었습니다.");
    } catch (error) {
      console.error("푸시 알림 설정 오류:", error);

      alert(
        "푸시 알림 설정에 실패했습니다.\n" +
          (error instanceof Error
            ? error.message
            : "설정을 확인해 주세요.")
      );
    }
  }}
>
  {alarmEnabled ? "🔔 알림 ON" : "🔕 알림 OFF"}
</button>

  
          {isAdmin && (
  <button
    className={`admin-toggle ${adminMode ? "active" : ""}`}
    onClick={() => {
      setAdminMode((value) => !value);
      closeForm();
    }}
  >
    {adminMode ? "관리자 모드 ON" : "관리자 모드 OFF"}
  </button>
)}
        </div>
      </header>
  

{isAdmin && adminMode && (
  memberManagementOpen ? (
   <section className="admin-panel members-page">
      <div>
        <h2>회원 관리</h2>
        <p>회원 목록 및 승인 상태 관리</p>
      </div>

      <button
        className="primary-button"
        onClick={() => setMemberManagementOpen(false)}
      >
        ← 관리자 화면으로 돌아가기
      </button>

      {membersLoading && (
        <p>회원 목록을 불러오는 중입니다...</p>
      )}

      {membersError && <p>{membersError}</p>}

      {!membersLoading && !membersError && (
        <div>
          {members.length === 0 ? (
            <p>등록된 회원이 없습니다.</p>
          ) : (
            members.map((member) => (
              <div key={member.id}>
                <p>
                  이름: {member.display_name || "이름 없음"}
                </p>
                <p>
                  권한: {member.role === "admin" ? "관리자" : "일반 회원"}
                </p>
                <p>
                  승인 상태: {member.approved ? "승인됨" : "승인 대기"}
                </p>

                <button
                  className="primary-button"
                  onClick={() => handleMemberApproval(member)}
                >
                  {member.approved ? "승인 취소" : "회원 승인"}
                </button>
                <button
  className="primary-button"
  onClick={() => handleMemberRoleChange(member)}
>
  {member.role === "admin" ? "일반 회원으로 변경" : "관리자 등록"}
</button>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  ) : (
    <section className="admin-panel">
      <div>
        <h2>보스 관리</h2>
        <p>보스 등록, 일정 수정 및 삭제</p>
      </div>

      <button
        className="primary-button"
        onClick={openAddForm}
      >
        + 보스 추가
      </button>

<button
  className="primary-button"
  onClick={() => {
    const membersUrl = new URL(window.location.href);
    membersUrl.searchParams.set("page", "members");
    window.open(membersUrl.toString(), "_blank");
  }}
>
  회원 관리
</button>

      
    </section>
  )
)}


      <section className="summary">
        <div className="summary-item">
          <span className="summary-label">전체 보스</span>
          <strong>{bosses.length}</strong>
        </div>
        <div className="summary-item">
          <span className="summary-label">일일 보스</span>
          <strong>{bosses.filter((boss) => boss.type === "daily").length}</strong>
        </div>
        <div className="summary-item">
          <span className="summary-label">주간 보스</span>
          <strong>{bosses.filter((boss) => boss.type === "weekly").length}</strong>
        </div>
      </section>

      <nav className="filters">
        {(
          [
            ["all", "전체 보스"],
            ["daily", "일일 보스"],
            ["weekly", "주간 보스"],
          ] as [FilterType, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            className={filter === value ? "filter active" : "filter"}
            onClick={() => {
              setFilter(value);
              closeForm();
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {formOpen && isAdmin && !editingId && (
        <BossEditor
          form={form}
          setForm={setForm}
          editing={false}
          error={formError}
          onSubmit={saveBoss}
          onCancel={closeForm}
        />
      )}

      <section className="boss-list">
        {visibleBosses.map((boss) => {
          const remaining = boss.nextSpawnAt - now;
          const showCut = isAdmin && remaining <= FIVE_MINUTES;
          const isEditingThisBoss = formOpen && editingId === boss.id;

          return (
            <div className="boss-item-wrap" key={boss.id}>

<article
  className={`boss-card ${
    boss.id === nextBossId ? "next-boss" : ""
  } ${
    remaining <= 10 * 60 * 1000
      ? "spawn-imminent"
      : ""
  }`}
>

                <div className="boss-content">
                  <div className="boss-heading-row">
                    <span className="bell-icon" aria-label="알림">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M3 5 1.8 3.5M21 5l1.2-1.5M12 1V0"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </span>

                    <span className="spawn-time">
                      {formatSpawnTime(boss.nextSpawnAt)}
                    </span>

                    {boss.id === nextBossId && (
                      <span className="next-tag">NEXT</span>
                    )}

                    <h2 className="boss-name">{boss.name}</h2>
                  </div>

                  <div className="boss-meta">
                    <span className="boss-type">
                      {boss.type === "daily" ? "일일 보스" : "주간 보스"}
                    </span>
                    <span className="boss-grade">{boss.grade}</span>
                    <span className="countdown-label">
                      {remaining <= 0
                        ? "출현 시간 경과"
                        : `남은 시간 ${formatCountdown(boss.nextSpawnAt, now)}`}
                    </span>
                  </div>

                  {boss.cutAt && (
                    <p className="last-cut">
                      최근 컷 {formatDateTime(boss.cutAt)} · 누적 {boss.cutCount}회
                    </p>
                  )}

{isAdmin && adminMode && (
                    <div className="boss-admin-actions">
                      <button
                        className="edit-button"
                        onClick={() =>
                          isEditingThisBoss
                            ? closeForm()
                            : openEditForm(boss)
                        }
                      >
                        {isEditingThisBoss ? "수정 닫기" : "수정"}
                      </button>
                      <button
                        className="delete-button"
                        onClick={() => deleteBoss(boss)}
                      >
                        삭제
                      </button>
                    </div>
                  )}
                </div>

                {showCut && isAdmin && adminMode && (
  <button
    className="cut-button"
    onClick={() => recordCut(boss.id)}
    title="현재 시각으로 컷 기록"
  >
    컷
  </button>
)}
              </article>

              {isEditingThisBoss && isAdmin && (
                <BossEditor
                  form={form}
                  setForm={setForm}
                  editing={true}
                  error={formError}
                  onSubmit={saveBoss}
                  onCancel={closeForm}
                />
              )}
            </div>
          );
        })}

        {visibleBosses.length === 0 && (
          <div className="empty-state">
            <p>등록된 보스가 없습니다.</p>
            {isAdmin && (
              <button className="primary-button" onClick={openAddForm}>
                첫 보스 등록하기
              </button>
            )}
          </div>
        )}
      </section>


      <footer className="app-footer">
        <p>출현 시각은 기기의 현지 시간을 기준으로 표시됩니다.</p>
        <p>
          {isAdmin
            ? "관리자 계정 · 보스 관리 권한"
            : "길드 에르메스 · 보스 출현 일정"}
        </p>
        <p>현재 데이터는 이 브라우저에 저장됩니다.</p>
      </footer>

    </main>
  );
}
