import { useMemo, useState, type ChangeEventHandler, type FormEvent } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { TurnstileWidget } from '../../components/security/TurnstileWidget';
import { kodiakEnv } from '../../config/env';
import { MatrixLoginError, verifyMatrixLogin } from './matrixLoginService';

type LoginMode = 'sign-in' | 'create-account' | 'reset-password';
type MessageTone = 'error' | 'success';

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

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
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
      {!isVisible ? (
        <path d="M4 20 20 4" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
      ) : null}
    </svg>
  );
}

function PasswordInput({ name, autoComplete, placeholder, value, onChange, disabled }: PasswordInputProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="password-field">
      <input
        type={isVisible ? 'text' : 'password'}
        name={name}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />

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
  {
    href: 'mailto:support@kodiak-connect.com?subject=Kodiak%20Connect%20Support',
    label: 'support@kodiak-connect.com',
  },
  {
    href: 'https://www.facebook.com/PapaKodiak/',
    label: 'Facebook',
  },
  {
    href: 'https://x.com/PapaKodiak92',
    label: 'X',
  },
  {
    href: 'https://www.instagram.com/papakodiak92/',
    label: 'Instagram',
  },
  {
    href: 'https://buymeacoffee.com/papakodiak',
    label: 'Buy Me a Coffee',
  },
];

async function openExternalLink(url: string) {
  try {
    await openUrl(url);
  } catch (error) {
    console.error('[Kodiak Connect] Failed to open footer link', error);

    if (url.startsWith('mailto:')) {
      window.location.href = url;
      return;
    }

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
    if (error.errcode === 'M_FORBIDDEN' || error.status === 403) {
      return 'Incorrect username or password.';
    }

    if (error.status === 429) {
      return 'Too many login attempts. Wait a moment, then try again.';
    }

    return error.message;
  }

  return 'Kodiak Connect could not reach the Matrix staging server.';
}

export function LoginScreen() {
  const [mode, setMode] = useState<LoginMode>('sign-in');
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [message, setMessage] = useState<FormMessage | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);

  const [loginId, setLoginId] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [createCaptchaToken, setCreateCaptchaToken] = useState('');

  const [resetEmail, setResetEmail] = useState('');
  const [resetCaptchaToken, setResetCaptchaToken] = useState('');

  const isTurnstileConfigured = Boolean(kodiakEnv.turnstileSiteKey);
  const showForgotPassword = failedAttempts >= 3;

  const emailMismatch = email.length > 0 && confirmEmail.length > 0 && normalizeEmail(email) !== normalizeEmail(confirmEmail);
  const passwordTooShort = password.length > 0 && password.length < 8;
  const passwordMismatch = password.length > 0 && confirmPassword.length > 0 && password !== confirmPassword;

  const heading = useMemo(() => {
    if (mode === 'create-account') return 'Create account.';
    if (mode === 'reset-password') return 'Reset access.';
    return 'Welcome back.';
  }, [mode]);

  const subheading = useMemo(() => {
    if (mode === 'create-account') return 'Create your account.';
    if (mode === 'reset-password') return 'Enter your email to start password recovery.';
    return 'Sign in to enter your private workspace.';
  }, [mode]);

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

    if (!loginId.trim() || !loginPassword) {
      setError('Enter your username/email and password.');
      return;
    }

    setIsSigningIn(true);
    setMessage(null);

    try {
      await verifyMatrixLogin(loginId, loginPassword);
      setFailedAttempts(0);
      setSuccess('Signed in successfully. Preparing your workspace.');
    } catch (error) {
      const nextAttempts = failedAttempts + 1;
      setFailedAttempts(nextAttempts);
      setError(getLoginErrorMessage(error));
    } finally {
      setIsSigningIn(false);
    }
  }

  function handleCreateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!username.trim()) {
      setError('Enter a username.');
      return;
    }

    if (!isValidEmail(email)) {
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

    setSuccess('Account details look good. Controlled registration will be connected after the Kodiak API is added.');
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

    setSuccess('If an account exists, a password reset email will be sent when mail service is connected.');
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
              <input
                type="text"
                name="username"
                autoComplete="username"
                placeholder="Username or email"
                value={loginId}
                onChange={(event) => setLoginId(event.target.value)}
                disabled={isSigningIn}
              />
            </label>

            <label>
              Password
              <PasswordInput
                name="password"
                autoComplete="current-password"
                placeholder="Password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                disabled={isSigningIn}
              />
            </label>

            {message ? (
              <div className={`login-status login-status--${message.tone}`}>
                <span className={`status-light ${message.tone === 'success' ? 'status-light--online' : 'status-light--offline'}`} aria-hidden="true" />
                <span>{message.text}</span>
              </div>
            ) : null}

            <div className="login-actions">
              <button type="submit" className="button-primary" disabled={isSigningIn}>
                {isSigningIn ? 'Signing In...' : 'Sign In'}
              </button>

              <button type="button" onClick={() => switchMode('create-account')} disabled={isSigningIn}>
                Create Account
              </button>
            </div>

            {showForgotPassword ? (
              <button type="button" className="login-link-button" onClick={() => switchMode('reset-password')} disabled={isSigningIn}>
                Forgot password?
              </button>
            ) : null}
          </form>
        ) : null}

        {mode === 'create-account' ? (
          <form className="login-form" onSubmit={handleCreateAccount} noValidate>
            <label>
              Username
              <input
                type="text"
                name="new-username"
                autoComplete="username"
                placeholder="Choose a username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>

            <div className="login-form__split">
              <label>
                Email
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>

              <label>
                Confirm email
                <input
                  type="email"
                  name="confirm-email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={confirmEmail}
                  onChange={(event) => setConfirmEmail(event.target.value)}
                />
                {emailMismatch ? <span className="login-field-warning">Email addresses must match.</span> : null}
              </label>
            </div>

            <div className="login-form__split">
              <label>
                Password
                <PasswordInput
                  name="new-password"
                  autoComplete="new-password"
                  placeholder="Create a password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                {passwordTooShort ? <span className="login-field-warning">Must be 8 characters or greater.</span> : null}
              </label>

              <label>
                Confirm password
                <PasswordInput
                  name="confirm-password"
                  autoComplete="new-password"
                  placeholder="Re-enter password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
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
              <button type="submit" className="button-primary">
                Create Account
              </button>

              <button type="button" onClick={() => switchMode('sign-in')}>
                Back to Sign In
              </button>
            </div>
          </form>
        ) : null}

        {mode === 'reset-password' ? (
          <form className="login-form" onSubmit={handleResetPassword} noValidate>
            <label>
              Email
              <input
                type="email"
                name="reset-email"
                autoComplete="email"
                placeholder="you@example.com"
                value={resetEmail}
                onChange={(event) => setResetEmail(event.target.value)}
              />
            </label>

            <TurnstileWidget onTokenChange={setResetCaptchaToken} />

            {message ? (
              <div className={`login-status login-status--${message.tone}`}>
                <span className={`status-light ${message.tone === 'success' ? 'status-light--online' : 'status-light--offline'}`} aria-hidden="true" />
                <span>{message.text}</span>
              </div>
            ) : null}

            <div className="login-actions">
              <button type="submit" className="button-primary">
                Send Reset Email
              </button>

              <button type="button" onClick={() => switchMode('sign-in')}>
                Back to Sign In
              </button>
            </div>
          </form>
        ) : null}
      </section>

      <LoginFooter />
    </main>
  );
}
