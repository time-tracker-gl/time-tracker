import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { C } from '../theme';

type Status = 'idle' | 'sending' | 'sent' | 'error';

/** Passwordless login in rpc style.
 *
 *  Two ways to finish the login from the same e-mail:
 *   - tippe den 6-stelligen Code in dieser App ein (funktioniert auch in der
 *     installierten iPhone-PWA, da kein Browser-Wechsel nötig ist), oder
 *   - öffne den Magic-Link (bequem am Desktop / im selben Browser-Tab).
 */
export function Login() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [codeError, setCodeError] = useState('');

  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const codeValid = /^\d{6}$/.test(code.trim());

  async function submit() {
    if (!supabase || !valid || status === 'sending') return;
    setStatus('sending');
    setMessage('');
    setCode('');
    setCodeError('');
    const redirect = window.location.origin + window.location.pathname;
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirect },
    });
    if (error) {
      setStatus('error');
      setMessage(error.message);
    } else {
      setStatus('sent');
    }
  }

  async function verify() {
    if (!supabase || !codeValid || verifying) return;
    setVerifying(true);
    setCodeError('');
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    });
    if (error) {
      setVerifying(false);
      setCodeError(error.message || 'Code ungültig oder abgelaufen.');
    }
    // Erfolg: onAuthStateChange in App setzt die Session, der Login wird ersetzt.
  }

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        justifyContent: 'center',
        background: '#DDE3E7',
        fontFamily: "'Roboto Condensed','Roboto',system-ui,sans-serif",
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 430,
          height: '100vh',
          background: C.lt1,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 0 40px rgba(14,23,33,.14)',
        }}
      >
        <header style={{ flex: '0 0 auto', padding: '18px 20px 14px', display: 'flex', alignItems: 'baseline', gap: 9, borderBottom: '1px solid #EAEDEF' }}>
          <span style={{ fontWeight: 700, fontSize: 22, letterSpacing: '-.5px', color: C.accent1 }}>rpc</span>
          <span style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: C.greyFooter, fontWeight: 500 }}>
            Zeiterfassung
          </span>
        </header>

        <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 28px' }}>
          {status === 'sent' ? (
            <div>
              <div style={{ background: C.accent1, color: C.lt1, padding: '9px 14px', fontWeight: 700, fontSize: 15, letterSpacing: '.04em' }}>
                E-Mail versendet
              </div>
              <p style={{ fontSize: 14, lineHeight: 1.6, color: '#2A333C', marginTop: 16 }}>
                Wir haben dir eine E-Mail an <strong>{email.trim()}</strong> geschickt. Gib den
                <strong> 6-stelligen Code</strong> aus der E-Mail hier ein – oder öffne den Anmelde-Link.
              </p>

              <label style={{ display: 'block', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: C.greyFooter, fontWeight: 700, margin: '18px 0 6px' }}>
                Anmelde-Code
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(e) => e.key === 'Enter' && verify()}
                placeholder="123456"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                style={{
                  width: '100%',
                  border: '1px solid #D5DBDF',
                  padding: '12px 13px',
                  fontSize: 22,
                  letterSpacing: '.4em',
                  textAlign: 'center',
                  fontWeight: 700,
                  color: C.dk1,
                  outline: 'none',
                  background: C.lt2,
                }}
              />
              {codeError && <p style={{ fontSize: 13, color: C.critical, margin: '10px 0 0' }}>{codeError}</p>}
              <button
                type="button"
                onClick={verify}
                disabled={!codeValid || verifying}
                style={{
                  width: '100%',
                  marginTop: 16,
                  padding: 14,
                  background: codeValid && !verifying ? C.accent1 : '#C7CFD4',
                  color: C.lt1,
                  fontSize: 14,
                  fontWeight: 700,
                  letterSpacing: '.04em',
                  cursor: codeValid && !verifying ? 'pointer' : 'not-allowed',
                }}
              >
                {verifying ? 'Wird geprüft …' : 'Anmelden'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setStatus('idle');
                  setCode('');
                  setCodeError('');
                }}
                style={{ marginTop: 14, padding: '11px 0', background: 'transparent', color: C.accent2, fontSize: 13, fontWeight: 700 }}
              >
                ← Andere E-Mail verwenden
              </button>
            </div>
          ) : (
            <div>
              <h1 style={{ margin: 0, fontWeight: 700, fontSize: 26, lineHeight: 1.15, color: C.dk1 }}>Anmelden</h1>
              <p style={{ fontSize: 14, lineHeight: 1.6, color: C.greyFooter, margin: '8px 0 22px' }}>
                Gib deine E-Mail ein – du bekommst einen Code und einen Anmelde-Link zugeschickt. Kein Passwort nötig.
              </p>
              <label style={{ display: 'block', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: C.greyFooter, fontWeight: 700, marginBottom: 6 }}>
                E-Mail
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                placeholder="name@firma.de"
                autoComplete="email"
                style={{ width: '100%', border: '1px solid #D5DBDF', padding: '12px 13px', fontSize: 15, color: C.dk1, outline: 'none', background: C.lt2 }}
              />
              {status === 'error' && (
                <p style={{ fontSize: 13, color: C.critical, margin: '10px 0 0' }}>{message || 'Anmeldung fehlgeschlagen.'}</p>
              )}
              <button
                type="button"
                onClick={submit}
                disabled={!valid || status === 'sending'}
                style={{
                  width: '100%',
                  marginTop: 18,
                  padding: 14,
                  background: valid && status !== 'sending' ? C.accent1 : '#C7CFD4',
                  color: C.lt1,
                  fontSize: 14,
                  fontWeight: 700,
                  letterSpacing: '.04em',
                  cursor: valid && status !== 'sending' ? 'pointer' : 'not-allowed',
                }}
              >
                {status === 'sending' ? 'Wird gesendet …' : 'Code anfordern'}
              </button>
            </div>
          )}
        </div>

        <div style={{ flex: '0 0 auto', padding: '14px 20px', borderTop: '1px solid #EAEDEF', fontSize: 11, color: C.muted, textAlign: 'center' }}>
          Deine Zeiten werden sicher in deinem Konto gespeichert.
        </div>
      </div>
    </div>
  );
}
