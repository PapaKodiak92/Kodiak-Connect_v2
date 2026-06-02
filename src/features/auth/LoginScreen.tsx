import { useEffect, useMemo, useState, type ChangeEventHandler, type FormEvent } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { TurnstileWidget } from '../../components/security/TurnstileWidget';
import { kodiakEnv } from '../../config/env';
import { MatrixLoginError, verifyMatrixLogin, type MatrixLoginIdentity } from './matrixLoginService';
import { resendKodiakEmailSignupCode, startKodiakEmailSignup, verifyKodiakEmailSignup } from './kodiakAuthService';

type LoginMode = 'sign-in' | 'create-account' | 'verify-email' | 'reset-password';
type MessageTone = 'error' | 'success';

interface LoginScreenProps {
  onLoginSuccess?: (identity: MatrixLoginIdentity) => void;
}

interface FormMessage {
  tone: MessageTone;
  text: string;
}

interface PasswordInputProps {
  name: string;
  autoComplete: string;
  placeholder: string;
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  disabled?: boolean;
}

const FALLBACK_RATE_LIMIT_MS = 60_000;

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

function isValidUsername(value: string) {
  return /^[a-z0-9._=-]{3,32}$/.test(normalizeUsername(value)) && !normalizeUsername(value).includes('..');
}

function EyeIcon({ isVisible }: { isVisible: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.8" fill="none" stroke="currentColor" strokeWidth="1.8" />
      {!isVisible ? <path d="M4 20 20 4" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" /> : null}
    </svg>
  );
}

function PasswordInput({ name, autoComplete, placeholder, value, onChange, disabled }: PasswordInputProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="password-field">
      <input type={isVisible ? 'text' : 'password'} name={name} autoComplete={autoComplete} placeholder={placeholder} value={value} onChange={onChange} disabled={disabled} />
      <button
        type="button"
        className={`password-toggle ${isVisible ? 'password-toggle--active' : ''}`}
        aria-label={isVisible ? 'Hide password' : 'Show password'}
        title={isVisible ? 'Hide password' : 'Show password'}
        onClick={() => setIsVisible((current) => !current)}
        disabled={disabled}
      >
        <EyeIcon isVisible={isVisible} />
      </button>
    </div>
  );
}

const footerLinks = [
  { href: 'mailto:support@kodiak-connect.com?subject=Kodiak%20Connect%20Support', label: 'support@kodiak-connect.com' },
  { href: 'https://www.facebook.com/PapaKodiak/', label: 'Facebook' },
  { href: 'https://x.com/PapaKodiak92', label: 'X' },
  { href: 'https://www.instagram.com/papakodiak92/', label: 'Instagram' },
  { href: 'https://buymeacoffee.com/papakodiak', label: 'Buy Me a Coffee' },
];

async function openExternalLink(url: string) {
  if (url.startsWith('mailto:')) {
    window.location.href = url;
    return;
  }

  try {
    await openUrl(url);
  } catch (error) {
    console.error('[Kodiak Connect] Failed to open footer link', error);
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

function LoginFooter() {
  return (
    <footer className="login-footer" aria-label="Kodiak Connect legal and support links">
      <div className="login-footer__copyright">&copy; 2026 Kodiak Holdings</div>
      <nav className="login-footer__links" aria-label="Kodiak Connect links">
        {footerLinks.map((link) => (
          <a
            key={link.href}
            href={link.href}
            onClick={(event) => {
              event.preventDefault();
              void openExternalLink(link.href);
            }}
          >
            {link.label}
          </a>
        ))}
      </nav>
    </footer>
  );
}

function getLoginErrorMessage(error: unknown) {
  if (error instanceof MatrixLoginError) {
    if (error.errcode === 'M_FORBIDDEN' || error.status === 403) return 'Incorrect username, email, or password.';
    if (error.status === 429) return 'Too many login attempts. Wait a moment, then try again.';
    return error.message;
  }

  return 'Kodiak Connect could not reach the Matrix server.';
}

function getRetryCooldownMs(error: unknown) {
  if (!(error instanceof MatrixLoginError) || error.status !== 429) return 0;
  return error.retryAfterMs && error.retryAfterMs > 0 ? error.retryAfterMs : FALLBACK_RATE_LIMIT_MS;
}

export function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [mode, setMode] = useState<LoginMode>('sign-in');
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [message, setMessage] = useState<FormMessage | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [isVerifyingEmail, setIsVerifyingEmail] = useState(false);
  const [isResendingCode, setIsResendingCode] = useState(false);
  const [loginCooldownUntil, setLoginCooldownUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [loginId, setLoginId] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [createCaptchaToken, setCreateCaptchaToken] = useState('');
  const [signupId, setSignupId] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationEmail, setVerificationEmail] = useState('');
  const [devVerificationCode, setDevVerificationCode] = useState('');

  const [resetEmail, setResetEmail] = useState('');
  const [resetCaptchaToken, setResetCaptchaToken] = useState('');

  const isTurnstileConfigured = Boolean(kodiakEnv.turnstileSiteKey);
  const showForgotPassword = failedAttempts >= 3;
  const isLoginCoolingDown = Boolean(loginCooldownUntil && loginCooldownUntil > now);
  const loginCooldownSeconds = loginCooldownUntil ? Math.max(0, Math.ceil((loginCooldownUntil - now) / 1000)) : 0;
  const isSignInDisabled = isSigningIn || isLoginCoolingDown;
  const isCreateDisabled = isCreatingAccount || isVerifyingEmail || isResendingCode;

  const emailMismatch = email.length > 0 && confirmEmail.length > 0 && normalizeEmail(email) !== normalizeEmail(confirmEmail);
  const usernameInvalid = username.length > 0 && !isValidUsername(username);
  const passwordTooShort = password.length > 0 && password.length < 8;
  const passwordMismatch = password.length > 0 && confirmPassword.length > 0 && password !== confirmPassword;

  useEffect(() => {
    if (!loginCooldownUntil) return undefined;
    const timer = window.setInterval(() => {
      const currentTime = Date.now();
      setNow(currentTime);
      if (currentTime >= loginCooldownUntil) setLoginCooldownUntil(null);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [loginCooldownUntil]);

  const heading = useMemo(() => {
    if (mode === 'create-account') return 'Create account.';
    if (mode === 'verify-email') return 'Verify email.';
    if (mode === 'reset-password') return 'Reset access.';
    return 'Welcome back.';
  }, [mode]);

  const subheading = useMemo(() => {
    if (mode === 'create-account') return 'Create your account.';
    if (mode === 'verify-email') return `Enter the code sent to ${verificationEmail || 'your email'}.`;
    if (mode === 'reset-password') return 'Enter your email to start password recovery.';
    return 'Sign in to enter your private workspace.';
  }, [mode, verificationEmail]);

  const signInButtonText = useMemo(() => {
    if (isSigningIn) return 'Signing In...';
    if (isLoginCoolingDown) return `Try again in ${loginCooldownSeconds}s`;
    return 'Sign In';
  }, [isLoginCoolingDown, isSigningIn, loginCooldownSeconds]);

  function setError(text: string) {
    setMessage({ tone: 'error', text });
  }

  function setSuccess(text: string) {
    setMessage({ tone: 'success', text });
  }

  function switchMode(nextMode: LoginMode) {
    setMode(nextMode);
    setMessage(null);
  }

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isLoginCoolingDown) return;

    if (!loginId.trim() || !loginPassword) {
      setError('Enter your username/email and password.');
      return;
    }

    setIsSigningIn(true);
    setMessage(null);

    try {
      const identity = await verifyMatrixLogin(loginId, loginPassword);
      setFailedAttempts(0);
      setLoginCooldownUntil(null);
      setSuccess('Signed in successfully. Preparing your workspace.');
      window.setTimeout(() => onLoginSuccess?.(identity), 350);
    } catch (error) {
      const nextAttempts = failedAttempts + 1;
      const retryCooldownMs = getRetryCooldownMs(error);
      setFailedAttempts(nextAttempts);
      if (retryCooldownMs > 0) setLoginCooldownUntil(Date.now() + retryCooldownMs);
      setError(getLoginErrorMessage(error));
    } finally {
      setIsSigningIn(false);
    }
  }

  async function handleCreateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanUsername = normalizeUsername(username);
    const cleanEmail = normalizeEmail(email);

    if (!cleanUsername) {
      setError('Enter a username.');
      return;
    }

    if (!isValidUsername(cleanUsername)) {
      setError('Username must be 3-32 lowercase letters, numbers, dots, underscores, equals, or hyphens.');
      return;
    }

    if (!isValidEmail(cleanEmail)) {
      setError('Enter a valid email address.');
      return;
    }

    if (!confirmEmail.trim()) {
      setError('Confirm your email address.');
      return;
    }

    if (emailMismatch) {
      setError('Email addresses do not match.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be 8 characters or greater.');
      return;
    }

    if (!confirmPassword) {
      setError('Confirm your password.');
      return;
    }

    if (passwordMismatch) {
      setError('Passwords do not match.');
      return;
    }

    if (isTurnstileConfigured && !createCaptchaToken) {
      setError('Complete the Cloudflare verification check.');
      return;
    }

    setIsCreatingAccount(true);
    setMessage(null);

    try {
      const signup = await startKodiakEmailSignup({
        email: cleanEmail,
        password,
        turnstileToken: createCaptchaToken,
        username: cleanUsername,
      });

      setSignupId(signup.signupId);
      setVerificationEmail(cleanEmail);
      setDevVerificationCode(signup.devVerificationCode ?? '');
      setVerificationCode('');
      setMode('verify-email');
      setSuccess(signup.emailSent ? 'Verification code sent. Check your email.' : 'Mail is not configured locally. Use the dev code shown below.');
    } catch (error) {
      console.error('[Kodiak Connect] Failed to start signup', error);
      setError(error instanceof Error ? error.message : 'Could not start signup. Try again.');
    } finally {
      setIsCreatingAccount(false);
    }
  }

  async function handleVerifyEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!signupId) {
      setError('Verification session expired. Start signup again.');
      return;
    }

    const cleanCode = verificationCode.trim().replace(/\s+/g, '');

    if (!/^\d{6}$/.test(cleanCode)) {
      setError('Enter the 6-digit verification code.');
      return;
    }

    setIsVerifyingEmail(true);
    setMessage(null);

    try {
      await verifyKodiakEmailSignup({ code: cleanCode, signupId });
      setSuccess('Email verified. Signing you in.');
      const identity = await verifyMatrixLogin(normalizeUsername(username), password);
      window.setTimeout(() => onLoginSuccess?.(identity), 350);
    } catch (error) {
      console.error('[Kodiak Connect] Failed to verify signup', error);
      setError(error instanceof Error ? error.message : 'Could not verify email. Try again.');
    } finally {
      setIsVerifyingEmail(false);
    }
  }

  async function handleResendVerificationCode() {
    if (!signupId) {
      setError('Verification session expired. Start signup again.');
      return;
    }

    setIsResendingCode(true);
    setMessage(null);

    try {
      const result = await resendKodiakEmailSignupCode(signupId);
      setDevVerificationCode(result.devVerificationCode ?? '');
      setSuccess(result.emailSent ? 'New verification code sent.' : 'Mail is not configured locally. Use the dev code shown below.');
    } catch (error) {
      console.error('[Kodiak Connect] Failed to resend code', error);
      setError(error instanceof Error ? error.message : 'Could not resend code. Try again.');
    } finally {
      setIsResendingCode(false);
    }
  }

  function handleResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isValidEmail(resetEmail)) {
      setError('Enter a valid email address.');
      return;
    }

    if (isTurnstileConfigured && !resetCaptchaToken) {
      setError('Complete the Cloudflare verification check.');
      return;
    }

    setSuccess('Password reset email flow will be wired after signup verification is stable.');
  }

  return (
    <main className="login-shell">
      <section className={`login-card login-card--${mode}`} aria-label="Kodiak Connect login">
        <div className="login-card__brand">
          <div className="brand-orb brand-orb--large">
            <img src="/kodiak-connect-icon.png" alt="" />
          </div>

          <div>
            <p className="eyebrow eyebrow--ember">Kodiak Connect</p>
            <h1>{heading}</h1>
            <p>{subheading}</p>
          </div>
        </div>

        {mode === 'sign-in' ? (
          <form className="login-form" onSubmit={handleSignIn} noValidate>
            <label>
              Username or email
              <input type="text" name="username" autoComplete="username" placeholder="Username or email" value={loginId} onChange={(event) => setLoginId(event.target.value)} disabled={isSignInDisabled} />
            </label>

            <label>
              Password
              <PasswordInput name="password" autoComplete="current-password" placeholder="Password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} disabled={isSignInDisabled} />
            </label>

            {message ? (
              <div className={`login-status login-status--${message.tone}`}>
                <span className={`status-light ${message.tone === 'success' ? 'status-light--online' : 'status-light--offline'}`} aria-hidden="true" />
                <span>{message.text}</span>
              </div>
            ) : null}

            <div className="login-actions">
              <button type="submit" className="button-primary" disabled={isSignInDisabled}>{signInButtonText}</button>
              <button type="button" onClick={() => switchMode('create-account')} disabled={isSigningIn}>Create Account</button>
            </div>

            {showForgotPassword ? <button type="button" className="login-link-button" onClick={() => switchMode('reset-password')} disabled={isSigningIn}>Forgot password?</button> : null}
          </form>
        ) : null}

        {mode === 'create-account' ? (
          <form className="login-form" onSubmit={handleCreateAccount} noValidate>
            <label>
              Username
              <input type="text" name="new-username" autoComplete="username" placeholder="Choose a username" value={username} onChange={(event) => setUsername(normalizeUsername(event.target.value))} disabled={isCreateDisabled} />
              {usernameInvalid ? <span className="login-field-warning">Use 3-32 lowercase letters, numbers, dots, underscores, equals, or hyphens.</span> : null}
            </label>

            <div className="login-form__split">
              <label>
                Email
                <input type="email" name="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} disabled={isCreateDisabled} />
              </label>

              <label>
                Confirm email
                <input type="email" name="confirm-email" autoComplete="email" placeholder="you@example.com" value={confirmEmail} onChange={(event) => setConfirmEmail(event.target.value)} disabled={isCreateDisabled} />
                {emailMismatch ? <span className="login-field-warning">Email addresses must match.</span> : null}
              </label>
            </div>

            <div className="login-form__split">
              <label>
                Password
                <PasswordInput name="new-password" autoComplete="new-password" placeholder="Create a password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={isCreateDisabled} />
                {passwordTooShort ? <span className="login-field-warning">Must be 8 characters or greater.</span> : null}
              </label>

              <label>
                Confirm password
                <PasswordInput name="confirm-password" autoComplete="new-password" placeholder="Re-enter password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} disabled={isCreateDisabled} />
                {passwordMismatch ? <span className="login-field-warning">Passwords must match.</span> : null}
              </label>
            </div>

            <TurnstileWidget onTokenChange={setCreateCaptchaToken} />

            {message ? (
              <div className={`login-status login-status--${message.tone}`}>
                <span className={`status-light ${message.tone === 'success' ? 'status-light--online' : 'status-light--offline'}`} aria-hidden="true" />
                <span>{message.text}</span>
              </div>
            ) : null}

            <div className="login-actions">
              <button type="submit" className="button-primary" disabled={isCreateDisabled}>{isCreatingAccount ? 'Sending Code...' : 'Create Account'}</button>
              <button type="button" onClick={() => switchMode('sign-in')} disabled={isCreateDisabled}>Back to Sign In</button>
            </div>
          </form>
        ) : null}

        {mode === 'verify-email' ? (
          <form className="login-form" onSubmit={handleVerifyEmail} noValidate>
            <label>
              Verification code
              <input type="text" inputMode="numeric" name="verification-code" autoComplete="one-time-code" placeholder="6-digit code" value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))} disabled={isCreateDisabled} />
            </label>

            {devVerificationCode ? (
              <div className="login-status login-status--success">
                <span className="status-light status-light--online" aria-hidden="true" />
                <span>Local dev code: {devVerificationCode}</span>
              </div>
            ) : null}

            {message ? (
              <div className={`login-status login-status--${message.tone}`}>
                <span className={`status-light ${message.tone === 'success' ? 'status-light--online' : 'status-light--offline'}`} aria-hidden="true" />
                <span>{message.text}</span>
              </div>
            ) : null}

            <div className="login-actions">
              <button type="submit" className="button-primary" disabled={isCreateDisabled || verificationCode.length !== 6}>{isVerifyingEmail ? 'Verifying...' : 'Verify Email'}</button>
              <button type="button" onClick={handleResendVerificationCode} disabled={isCreateDisabled}>{isResendingCode ? 'Sending...' : 'Resend Code'}</button>
            </div>

            <button type="button" className="login-link-button" onClick={() => switchMode('create-account')} disabled={isCreateDisabled}>Back to account details</button>
          </form>
        ) : null}

        {mode === 'reset-password' ? (
          <form className="login-form" onSubmit={handleResetPassword} noValidate>
            <label>
              Email
              <input type="email" name="reset-email" autoComplete="email" placeholder="you@example.com" value={resetEmail} onChange={(event) => setResetEmail(event.target.value)} />
            </label>

            <TurnstileWidget onTokenChange={setResetCaptchaToken} />

            {message ? (
              <div className={`login-status login-status--${message.tone}`}>
                <span className={`status-light ${message.tone === 'success' ? 'status-light--online' : 'status-light--offline'}`} aria-hidden="true" />
                <span>{message.text}</span>
              </div>
            ) : null}

            <div className="login-actions">
              <button type="submit" className="button-primary">Send Reset Email</button>
              <button type="button" onClick={() => switchMode('sign-in')}>Back to Sign In</button>
            </div>
          </form>
        ) : null}
      </section>

      <LoginFooter />
    </main>
  );
}
