
import { useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "./supabase";

type AuthProps = {
  onLogin: () => void;
};

export default function Auth({ onLogin }: AuthProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setLoading(true);

    try {
      const cleanEmail = email.trim().toLowerCase();

      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: { display_name: displayName.trim() },
          },
        });

        if (error) throw error;

        if (data.session) {
          setMessage("회원가입이 완료되었습니다. 관리자 승인을 기다려 주세요.");
          onLogin();
        } else {
          setMessage(
            "가입 신청이 완료되었습니다. 이메일 인증이 필요하다면 이메일을 확인해 주세요."
          );
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });

        if (error) throw error;

        setMessage("로그인되었습니다.");
        onLogin();
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "요청을 처리하지 못했습니다. 다시 시도해 주세요."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-scene">
        <header className="auth-brand">
          <h1>HERMES 3</h1>
          <p className="auth-brand-subtitle">BOSS TIMER</p>
          <p className="auth-guild">에르메스 길드</p>
          <p className="auth-tagline">
            보스의 등장 시간을 한눈에,
            <br />
            더 강한 전투를 준비하세요.
          </p>
        </header>

        <section className="auth-card">
          <h2>{isSignUp ? "회원가입" : "로그인"}</h2>
          <p className="auth-description">
            {isSignUp
              ? "계정을 만들고 관리자 승인을 신청하세요."
              : "계정에 로그인하고 보스 타이머를 시작하세요."}
          </p>

          <form onSubmit={handleSubmit}>
            {isSignUp && (
              <label>
                게임 닉네임
                <input
                  type="text"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  required
                  maxLength={40}
                  placeholder="게임 닉네임을 입력하세요"
                  autoComplete="nickname"
                />
              </label>
            )}

            <label>
              이메일
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="email"
                placeholder="이메일 주소를 입력하세요"
              />
            </label>

            <label>
              비밀번호
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={6}
                autoComplete={isSignUp ? "new-password" : "current-password"}
                placeholder="비밀번호를 입력하세요"
              />
            </label>

            <button
              type="submit"
              className="auth-submit"
              disabled={loading}
            >
              {loading
                ? "처리 중..."
                : isSignUp
                  ? "회원가입 신청"
                  : "로그인"}
            </button>
          </form>

          {message && (
            <p className="auth-message" role="status">
              {message}
            </p>
          )}

          <button
            type="button"
            className="auth-switch"
            onClick={() => {
              setIsSignUp((current) => !current);
              setMessage("");
            }}
          >
            {isSignUp
              ? "이미 계정이 있나요? 로그인"
              : "계정이 없나요? 회원가입"}
          </button>

          <p className="auth-security">
            ◈ 안전한 계정 보호로 소중한 정보를 지켜드립니다.
          </p>
        </section>
      </div>
    </main>
  );
}
