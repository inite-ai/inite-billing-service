'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useAuth } from '@/contexts/AuthContext'
import LanguageSwitcher from '@/components/ui/LanguageSwitcher'

/**
 * INITE Billing — landing page ("Ledger" theme).
 * All visual styling lives in globals.css scoped under `.lp` so the
 * authenticated app is untouched. Copy comes from the `landing` i18n
 * namespace (EN + RU parity enforced in messages/{en,ru}.json).
 */
export default function LandingClient() {
  const { user } = useAuth()
  const t = useTranslations('landing')

  const primaryHref = user ? '/dashboard' : '/login'
  const primaryLabel = user ? t('goToDashboard') : t('getStarted')

  return (
    <div className="lp">
      <div className="lp-grain" />
      <div className="lp-gridbg" />
      <div className="lp-vign" />

      {/* NAV */}
      <nav>
        <div className="wrap navrow">
          <div className="brand">
            <div className="logo">IN</div>
            {t('brand')}
            <b>{t('brandHighlight')}</b>
          </div>
          <div className="navr">
            <Link href="/docs" className="btn ghost">
              {t('docs')}
            </Link>
            <Link href="/blog" className="btn ghost">
              {t('footerBlog')}
            </Link>
            <LanguageSwitcher />
            {user ? (
              <Link href="/dashboard" className="btn ghost">
                {t('dashboard')}
              </Link>
            ) : (
              <Link href="/login" className="btn ghost">
                {t('signIn')}
              </Link>
            )}
            <Link href={primaryHref} className="btn acc">
              {t('navStart')}
            </Link>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <header className="wrap hero mesh">
        <svg
          className="hero-graphic"
          viewBox="0 0 600 500"
          fill="none"
          aria-hidden="true"
        >
          <g stroke="#CCFF00" strokeWidth="1">
            <path d="M-20 40 L560 250" opacity=".5" />
            <path d="M-20 150 L560 250" opacity=".38" />
            <path d="M-20 250 L560 250" opacity=".55" />
            <path d="M-20 350 L560 250" opacity=".38" />
            <path d="M-20 460 L560 250" opacity=".5" />
          </g>
          <g stroke="#CCFF00" fill="none">
            <circle cx="560" cy="250" r="34" opacity=".55" />
            <circle cx="560" cy="250" r="82" opacity=".26" />
            <circle cx="560" cy="250" r="140" opacity=".14" />
            <circle cx="560" cy="250" r="205" opacity=".07" />
            <circle className="ping" cx="560" cy="250" r="205" opacity=".4" />
            <circle className="ping b" cx="560" cy="250" r="205" opacity=".4" />
            <circle className="ping c" cx="560" cy="250" r="205" opacity=".4" />
          </g>
          <circle cx="560" cy="250" r="6" fill="#CCFF00" />
        </svg>
        <div className="watermark" style={{ right: '-30px', bottom: '-120px' }}>
          ₽
        </div>

        <div>
          <div className="h-eye rise d1">
            <span className="eyebrow">
              <span className="dot">◆</span> {t('heroEyebrow')}
            </span>
          </div>
          <h1 className="h1 rise d2">
            {t('heroTitleLead')}
            <br />
            <span className="l2">{t('heroTitleMuted')}</span>{' '}
            <span className="mk">{t('heroTitleAccent')}</span>
          </h1>
          <p className="sub rise d3">
            {t.rich('heroSub', { b: (chunks) => <b>{chunks}</b> })}
          </p>
          <div className="h-cta rise d3">
            <Link href={primaryHref} className="btn acc">
              {primaryLabel} →
            </Link>
            <Link href="/docs" className="btn ghost">
              {t('docs')}
            </Link>
          </div>
          <div className="microrail rise d4">{t('heroMicro')}</div>
        </div>

        <div className="receipt rise d3 tex-scan">
          <div className="rc-top">
            <div className="path">
              POST /v1/checkout/<span>pay</span>
            </div>
            <div className="live">
              <i />
              live
            </div>
          </div>
          <div className="rc-body">
            <div className="rc-line">
              <span className="k">rail</span>
              <span className="v">stripe</span>
            </div>
            <div className="rc-line">
              <span className="k">amount</span>
              <span className="v tnum">₽ 4 900,00</span>
            </div>
            <div className="rc-line">
              <span className="k">status</span>
              <span className="v ok">→ paid</span>
            </div>
            <div className="rc-line">
              <span className="k">latency</span>
              <span className="v tnum">128 ms</span>
            </div>
          </div>
          <div className="rc-foot">
            <span className="chip">
              <i>✓</i> {t('receiptCheck1')}
            </span>
            <span className="chip">
              <i>✓</i> {t('receiptCheck2')}
            </span>
            <span className="chip">
              <i>✓</i> {t('receiptCheck3')}
            </span>
          </div>
          <div className="stamp">PAID</div>
        </div>
      </header>

      {/* RAILS TICKER */}
      <div className="ticker mesh tex-dots">
        <div className="track">
          <span>Stripe</span>
          <span>{t('tickerCrypto')}</span>
          <span>Apple IAP</span>
          <span>Google Play</span>
          <span>Lava</span>
          <span>ONE</span>
          <span>Stripe</span>
          <span>{t('tickerCrypto')}</span>
          <span>Apple IAP</span>
          <span>Google Play</span>
          <span>Lava</span>
          <span>ONE</span>
        </div>
      </div>

      <div className="wrap">
        {/* STATS */}
        <div className="stats">
          <div className="stat">
            <div className="n">
              <em>6</em>
            </div>
            <div className="l">{t('statRailsLabel')}</div>
          </div>
          <div className="stat">
            <div className="n">N</div>
            <div className="l">{t('statLevelsLabel')}</div>
          </div>
          <div className="stat">
            <div className="n">
              <em>19</em>
            </div>
            <div className="l">{t('statToolsLabel')}</div>
          </div>
        </div>

        {/* 01 — FEATURES */}
        <section className="sec" id="features">
          <div className="sechead">
            <span className="secnum">01</span>
            <h2>{t('featuresTitle')}</h2>
            <div className="hint">{t('featuresHint')}</div>
          </div>

          <div className="bento">
            <div className="cell c-lg mesh tex-hatch">
              <div className="tag">{t('featRailsTag')}</div>
              <div className="ct">{t('featRailsTitle')}</div>
              <div className="cd">{t('featRailsDesc')}</div>
              <div className="diagram">
                <div className="rails-col">
                  <div className="pill">Stripe</div>
                  <div className="pill">{t('railCrypto')}</div>
                  <div className="pill">Apple / Google</div>
                  <div className="pill">Lava · ONE</div>
                </div>
                <span className="arrow">──▶</span>
                <div className="core">{t('railCore')}</div>
                <span className="arrow">──▶</span>
                <div className="outs">
                  <span>{t('outSubs')}</span>
                  <span>{t('outCredits')}</span>
                  <span>{t('outReferrals')}</span>
                </div>
              </div>
            </div>

            <div className="cell c-md">
              <div className="tag">{t('featSubsTag')}</div>
              <div className="ct">{t('featSubsTitle')}</div>
              <div className="cd">{t('featSubsDesc')}</div>
              <div className="meter">
                <div className="row">
                  <span>{t('meterLabel')}</span>
                  <span className="tnum">7 400 / 10 000</span>
                </div>
                <div className="bar">
                  <i style={{ width: '74%' }} />
                </div>
                <div className="quota">{t('meterQuota')}</div>
              </div>
            </div>

            <div className="cell c-3 tex-scan">
              <div className="tag">{t('featAsstTag')}</div>
              <div className="ct">{t('featAsstTitle')}</div>
              <div className="cd">{t('featAsstDesc')}</div>
              <div className="chat">
                <div className="msg u">{t('asstUser')}</div>
                <div className="msg a">{t('asstReply')}</div>
                <div className="confirm">
                  <b>{t('confirm')}</b>
                  <span className="no">{t('cancel')}</span>
                </div>
              </div>
            </div>

            <div className="cell c-3">
              <div className="tag">{t('featRetTag')}</div>
              <div className="ct">{t('featRetTitle')}</div>
              <div className="cd">{t('featRetDesc')}</div>
              <div className="diagram">
                <div className="pill">{t('flowAbandoned')}</div>
                <span className="arrow">▶</span>
                <div className="pill">{t('flowReminder')}</div>
                <span className="arrow">▶</span>
                <div className="core">{t('flowPaid')}</div>
              </div>
            </div>

            <div className="cell c-3">
              <div className="tag">{t('featRefTag')}</div>
              <div className="ct">{t('featRefTitle')}</div>
              <div className="cd">{t('featRefDesc')}</div>
              <div className="tree">
                <div className="node you">{t('you')}</div>
                <div className="conn" />
                <div className="rown">
                  <div className="node">L1</div>
                  <div className="node">L1</div>
                  <div className="node">L1</div>
                </div>
                <div className="rown">
                  <div className="node">L2</div>
                  <div className="node">L2</div>
                  <div className="node">L2</div>
                  <div className="node">L2</div>
                </div>
              </div>
            </div>

            <div className="cell c-3 mesh">
              <div className="tag">{t('featScaleTag')}</div>
              <div className="ct">{t('featScaleTitle')}</div>
              <div className="cd">{t('featScaleDesc')}</div>
              <div className="diagram">
                <div className="core">{t('scaleCore')}</div>
                <span className="arrow">──▶</span>
                <div className="rails-col">
                  <div className="pill">club</div>
                  <div className="pill">education</div>
                </div>
                <div className="rails-col">
                  <div className="pill">shop</div>
                  <div className="pill">health</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 02 — REFERRAL */}
        <section className="sec" id="referral">
          <div className="sechead">
            <span className="secnum">02</span>
            <h2>{t('referralTitle')}</h2>
            <div className="hint">{t('referralHint')}</div>
          </div>
          <div className="ref">
            <div className="ref-card">
              <div className="eyebrow" style={{ marginBottom: '6px' }}>
                {t('exampleSub')}
              </div>
              <div className="levels">
                <div className="lvl">
                  <span className="lb">{t('exampleLevel', { level: 1 })}</span>
                  <div className="track2">
                    <i style={{ width: '100%' }} />
                  </div>
                  <span className="amt tnum">{t('exampleAmt1')}</span>
                </div>
                <div className="lvl">
                  <span className="lb">{t('exampleLevel', { level: 2 })}</span>
                  <div className="track2">
                    <i style={{ width: '33%' }} />
                  </div>
                  <span className="amt tnum">{t('exampleAmt2')}</span>
                </div>
                <div className="lvl">
                  <span className="lb">{t('exampleLevel', { level: 3 })}</span>
                  <div className="track2">
                    <i style={{ width: '20%' }} />
                  </div>
                  <span className="amt tnum">{t('exampleAmt3')}</span>
                </div>
              </div>
              <div className="total">
                <span className="tl">{t('exampleTotal')}</span>
                <span className="tv">23%</span>
              </div>
            </div>
            <div className="ref-card">
              <div className="eyebrow" style={{ marginBottom: '14px' }}>
                {t('scenarioTitle')}
              </div>
              <div
                className="cd"
                style={{ color: 'var(--dim)', fontSize: '14.5px', marginBottom: '6px' }}
              >
                {t('scenarioDesc')}
              </div>
              <div className="tree">
                <div className="node you">{t('you')}</div>
                <div className="conn" />
                <div className="rown">
                  <div className="node">•</div>
                  <div className="node">•</div>
                  <div className="node">•</div>
                </div>
                <div className="rown">
                  <div className="node">·</div>
                  <div className="node">·</div>
                  <div className="node">·</div>
                  <div className="node">·</div>
                  <div className="node">·</div>
                </div>
                <div className="eyebrow" style={{ marginTop: '6px' }}>
                  {t('andDeeper')}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 03 — DEVELOPERS */}
        <section className="sec">
          <div className="sechead">
            <span className="secnum">03</span>
            <h2>{t('devTitle')}</h2>
            <div className="hint">{t('devHint')}</div>
          </div>
          <div className="spec">
            <div className="s">
              <div className="st">REST</div>
              <div className="sh">{t('devApiTitle')}</div>
              <div className="sp">{t('devApiDesc')}</div>
            </div>
            <div className="s">
              <div className="st">EVENTS</div>
              <div className="sh">{t('devHooksTitle')}</div>
              <div className="sp">{t('devHooksDesc')}</div>
            </div>
            <div className="s">
              <div className="st">AUTH</div>
              <div className="sh">{t('devAuthTitle')}</div>
              <div className="sp">{t('devAuthDesc')}</div>
            </div>
            <div className="s">
              <div className="st">KEYS</div>
              <div className="sh">{t('devKeysTitle')}</div>
              <div className="sp">{t('devKeysDesc')}</div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="ctaband mesh tex-dots">
          <div
            className="watermark"
            style={{ left: '50%', top: '-90px', transform: 'translateX(-50%)', opacity: 0.03 }}
          >
            ₽
          </div>
          <h2>{t('ctaTitle')}</h2>
          <p>{t('ctaDescription')}</p>
          <Link href={primaryHref} className="btn acc">
            {user ? t('openDashboard') : t('ctaButton')} →
          </Link>
        </section>
      </div>

      {/* FOOTER */}
      <footer>
        <div className="wrap frow">
          <div className="brand">
            <div className="logo">IN</div>
            {t('footerBrand')}
          </div>
          <div className="flinks">
            <Link href="/docs">{t('footerDocs')}</Link>
            <Link href="/blog">{t('footerBlog')}</Link>
            <a
              href="https://github.com/inite-ai/inite-billing-service"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('footerGithub')}
            </a>
            <a href="mailto:support@inite.ai">{t('footerSupport')}</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
