/**
 * Office 3D — a live 3D office where every agent has their own avatar and
 * their activity reflects what they are really doing right now.
 *
 * Unified Hermes plugin package: this is the DESKTOP half (`desktop/plugin.js`),
 * with the live-state backend in `dashboard/plugin_api.py` mounted at
 * /api/plugins/office3d/ (requires `office3d` in `plugins.enabled`).
 *
 * Plain ESM, loaded uncompiled — UI is jsx() calls, not JSX syntax.
 * Only these imports resolve: @hermes/plugin-sdk, react, react/jsx-runtime.
 * The 3D room is CSS: one perspective stage, one rotated world plane,
 * counter-rotated billboards for faces/labels. No canvas, no extra libs.
 */

import { host, useQuery, ROUTES_AREA, SIDEBAR_NAV_AREA, PALETTE_AREA, Skeleton } from '@hermes/plugin-sdk'
import { useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'office3d'
const PATH = '/office3d'

// Captured at register() so components can call the scoped backend.
let ctx = null

/* ------------------------------------------------------------------ *
 * Scene constants — camera, palette, layout
 * ------------------------------------------------------------------ */

const UNIT = 118            // px per grid unit on the world plane
const WORLD_W = 14.2        // grid units
const WORLD_H = 8.8
const CAM = 'rotateX(58deg) rotateZ(45deg)'          // world plane → isometric
const BILLBOARD = 'rotateZ(-45deg) rotateX(-58deg)'  // faces the camera

// Sleek dark palette (the app is dark-themed; scene lights stay constant).
const C = {
  floorA: '#0c1424', floorB: '#0a1120',
  grid: 'rgba(96,165,250,0.07)', edge: 'rgba(96,165,250,0.18)',
  warm: 'rgba(251,191,36,0.10)', cool: 'rgba(56,189,248,0.08)',
  glass: 'rgba(125,211,252,0.055)', glassEdge: 'rgba(125,211,252,0.28)',
  deskTop: 'linear-gradient(135deg,#1c2740,#141d31)', deskEdge: '#0d1526',
  shadow: 'rgba(0,0,0,0.5)'
}
const STATUS_COLORS = {
  working: '#34d399', idle: '#fbbf24', blocked: '#f87171', off: '#475569'
}

// Desk spots (grid units) — org chart: managers at the back, CEO front-center,
// engineering bullpen to the right, meeting room + coffee corner + server rack.
const LAYOUT = {
  sofia: [5.2, 2.7], syafiqah: [2.6, 0.9], naura: [4.2, 0.9], rina: [5.8, 0.9],
  maisarah: [7.4, 0.9], nafisah: [9.0, 0.9], hana: [4.0, 2.3],
  lina: [7.8, 2.9], aisyah: [9.4, 2.9], nadia: [11.0, 2.9],
  nurul: [7.8, 4.3], alya: [9.4, 4.3], kira: [11.0, 4.3],
  balqis: [7.8, 5.7], elizabeth: [9.4, 5.7], lisa: [11.0, 5.7], zara: [12.6, 5.7],
  farah: [8.6, 7.1], shiela: [10.2, 7.1], ain: [11.8, 7.1]
}
const COFFEE_SPOTS = [
  [1.15, 1.15], [1.65, 1.5], [1.15, 1.75], [1.85, 1.05], [2.05, 1.65], [0.85, 1.35]
]

const px = v => v * UNIT

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

const fmtTok = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n))

function Billboard({ u, v, z, children, extra }) {
  // A card standing on the world plane but always facing the camera.
  return jsx('div', {
    style: {
      position: 'absolute', left: px(u), top: px(v), zIndex: Math.round((u + v) * 10) + (z || 0),
      transform: `translateZ(${z || 0}px) ${BILLBOARD}`, transformStyle: 'preserve-3d'
    },
    children
  })
}

function Desk({ u, v, tint, glow }) {
  return jsxs('div', {
    style: {
      position: 'absolute', left: px(u), top: px(v), zIndex: Math.round((u + v) * 10) - 2,
      transformStyle: 'preserve-3d'
    },
    children: [
      jsx('div', {
        style: {
          position: 'absolute', left: -14, top: -6, width: 170, height: 110,
          background: `radial-gradient(ellipse at center, ${C.shadow} 0%, transparent 65%)`,
          transform: 'translateZ(1px)'
        }
      }),
      jsx('div', {
        style: {
          position: 'absolute', left: 6, top: 6, width: 136, height: 66,
          borderRadius: 10, background: C.deskEdge, opacity: 0.9, transform: 'translateZ(30px)'
        }
      }),
      jsx('div', {
        style: {
          position: 'absolute', left: 0, top: 0, width: 136, height: 66,
          borderRadius: 10, background: C.deskTop,
          border: '1px solid rgba(148,163,184,0.16)',
          boxShadow: glow ? `0 0 22px ${tint}22` : 'none',
          transform: 'translateZ(46px)'
        }
      }),
      jsxs('div', {
        style: {
          position: 'absolute', left: 34, top: 8, width: 58, height: 38,
          borderRadius: 6, background: '#0b1220', border: '1px solid rgba(148,163,184,0.25)',
          transform: `translateZ(70px) ${BILLBOARD}`, overflow: 'hidden'
        },
        children: [
          jsx('div', {
            style: {
              position: 'absolute', inset: 3, borderRadius: 3,
              background: glow
                ? `linear-gradient(160deg, ${tint}33, #0b1220 70%)`
                : 'linear-gradient(160deg,#141d31,#0b1220 70%)'
            }
          }),
          glow ? jsx('div', {
            style: {
              position: 'absolute', left: 6, top: 7, right: 10, height: 3,
              borderRadius: 2, background: tint, opacity: 0.85
            }
          }) : null,
          glow ? jsx('div', {
            style: {
              position: 'absolute', left: 6, top: 14, right: 20, height: 3,
              borderRadius: 2, background: '#64748b', opacity: 0.6
            }
          }) : null
        ]
      })
    ]
  })
}

function Avatar({ a, u, v, avatars, onHover }) {
  const tint = STATUS_COLORS[a.status] || STATUS_COLORS.off
  const active = a.status === 'working'
  const bubble = (a.status === 'working' || a.status === 'blocked') ? a.detail : null
  return jsxs('div', {
    style: {
      position: 'absolute', left: px(u), top: px(v), zIndex: Math.round((u + v) * 10),
      transformStyle: 'preserve-3d',
      transition: 'left 1.4s ease-in-out, top 1.4s ease-in-out'
    },
    onMouseEnter: () => onHover(a),
    onMouseLeave: () => onHover(null),
    children: [
      jsx('div', {
        style: {
          position: 'absolute', left: -8, top: -4, width: 90, height: 62,
          background: `radial-gradient(ellipse at center, ${C.shadow} 0%, transparent 68%)`,
          transform: 'translateZ(1px)'
        }
      }),
      jsx('div', {
        style: {
          position: 'absolute', left: 2, top: 0, width: 76, height: 76,
          borderRadius: '50%', border: `2px solid ${tint}`, opacity: a.status === 'off' ? 0.35 : 0.9,
          boxShadow: active ? `0 0 18px ${tint}66` : 'none',
          transform: 'translateZ(2px)'
        }
      }),
      jsxs('div', {
        style: {
          position: 'absolute', left: -88, bottom: 0, width: 176,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
          transformOrigin: 'bottom center',
          transform: BILLBOARD, cursor: 'default'
        },
        children: [
          bubble ? jsxs('div', {
            className: 'office3d-bob',
            style: {
              maxWidth: 210, padding: '5px 11px', borderRadius: 10,
              background: 'rgba(11,18,32,0.92)', border: `1px solid ${tint}55`,
              color: '#dbe7f5', fontSize: 13, lineHeight: 1.3, textAlign: 'center',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
            },
            children: [
              jsx('span', {
                style: {
                  display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                  background: tint, marginRight: 5, verticalAlign: 'middle'
                }
              }),
              a.detail
            ]
          }) : null,
          jsx('div', {
            style: {
              width: 72, height: 72, borderRadius: '50%', overflow: 'hidden',
              border: `2.5px solid ${tint}`, opacity: a.status === 'off' ? 0.55 : 1,
              boxShadow: `0 6px 16px rgba(0,0,0,0.45)`, background: '#16213a'
            },
            children: avatars && avatars[a.name]
              ? jsx('img', {
                  src: avatars[a.name], alt: a.name,
                  style: { width: '100%', height: '100%', objectFit: 'cover' }
                })
              : jsx('div', {
                  style: {
                    width: '100%', height: '100%', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', color: '#cbd5e1', fontSize: 22, fontWeight: 600
                  },
                  children: (a.name || '?').slice(0, 2).toUpperCase()
                })
          }),
          jsxs('div', {
            style: { textAlign: 'center', marginTop: -1 },
            children: [
              jsx('div', {
                style: {
                  color: '#e2eaf5', fontSize: 17, fontWeight: 600,
                  textShadow: '0 1px 3px rgba(0,0,0,0.8)'
                },
                children: a.name
              }),
              jsx('div', {
                style: {
                  color: 'var(--ui-text-tertiary)', fontSize: 12,
                  textShadow: '0 1px 2px rgba(0,0,0,0.8)'
                },
                children: a.role
              })
            ]
          })
        ]
      })
    ]
  })
}

function Wall({ u, v, w, rot }) {
  // Glass partition standing on the plane edge at (u,v); rot: 0 (along +u) / 1 (along +v).
  const len = rot ? WORLD_H * UNIT : w * UNIT
  return jsx('div', {
    style: {
      position: 'absolute', left: px(u), top: px(v) - 170, width: len, height: 170,
      background: `linear-gradient(180deg, ${C.glass}, rgba(125,211,252,0.02))`,
      border: `1px solid ${C.glassEdge}`, borderBottom: 'none',
      transformOrigin: 'bottom',
      transform: rot ? 'rotateZ(90deg) rotateX(-90deg)' : 'rotateX(-90deg)',
      zIndex: 900
    }
  })
}

function RoomLabel({ u, v, text }) {
  return jsx('div', {
    style: {
      position: 'absolute', left: px(u), top: px(v), transform: BILLBOARD,
      padding: '2px 8px', borderRadius: 7, background: 'rgba(11,18,32,0.75)',
      border: '1px solid rgba(148,163,184,0.25)', color: 'var(--ui-text-tertiary)',
      fontSize: 12.5, letterSpacing: 0.4, whiteSpace: 'nowrap', zIndex: 5,
      transformOrigin: 'bottom center'
    },
    children: text
  })
}

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

function OfficePage() {
  const q = useQuery({
    queryKey: ['office3d', 'office'],
    queryFn: () => ctx.rest('/office'),
    refetchInterval: 15000,
    staleTime: 10000
  })
  const av = useQuery({
    queryKey: ['office3d', 'avatars'],
    queryFn: () => ctx.rest('/avatars'),
    staleTime: Infinity,
    refetchInterval: false
  })
  const [hover, setHover] = useState(null)

  if (q.isLoading) {
    return jsx('div', {
      className: 'flex h-full flex-col gap-3 p-6',
      children: [1, 2, 3].map(i => jsx(Skeleton, { className: 'h-24 w-full' }, i))
    })
  }
  if (q.isError) {
    return jsx('div', {
      className: 'flex h-full flex-col items-center justify-center gap-2 p-6 text-sm',
      children: [
        jsx('div', { className: 'font-medium', children: 'Office 3D backend unavailable' }),
        jsx('div', {
          className: 'text-(--ui-text-tertiary)',
          children: 'Enable the plugin backend: add "office3d" to plugins.enabled in config.yaml, then restart the app.'
        })
      ]
    })
  }

  const d = q.data || {}
  const agents = d.agents || []
  const counts = d.counts || {}
  const avatars = av.data || {}

  // Position each agent: working/blocked at their desk, idle wanders to the
  // coffee corner, off stays at the desk (dimmed). Movement animates.
  const placed = agents.map((a, i) => {
    const desk = LAYOUT[a.name] || [2, 2]
    let u = desk[0] + 0.16, v = desk[1] + 0.72
    if (a.status === 'idle') {
      const spot = COFFEE_SPOTS[i % COFFEE_SPOTS.length]
      u = spot[0]; v = spot[1]
    }
    return { a, u, v }
  }).sort((x, y) => (x.u + x.v) - (y.u + y.v))

  return jsxs('div', {
    className: 'relative h-full w-full overflow-hidden bg-(--ui-bg)',
    children: [
      jsx('style', {
        children: '@keyframes office3d-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-3px) } } .office3d-bob { animation: office3d-bob 2.4s ease-in-out infinite }'
      }),
      jsxs('div', {
        className: 'absolute left-0 right-0 top-0 z-30 flex items-center justify-between px-5 py-3',
        children: [
          jsxs('div', {
            className: 'flex items-baseline gap-3',
            children: [
              jsx('div', { className: 'text-base font-medium', children: 'Office 3D — live floor' }),
              jsx('div', {
                className: 'text-[0.6875rem] text-(--ui-text-tertiary)',
                children: `generated ${d.generated_at || '?'} · ${d.timezone || ''}`
              })
            ]
          }),
          jsx('div', {
            className: 'flex items-center gap-2',
            children: ['working', 'idle', 'blocked', 'off'].map(s => jsxs('div', {
              className: 'flex items-center gap-1.5 rounded-md border border-(--ui-stroke-secondary) px-2 py-1 text-[0.6875rem]',
              children: [
                jsx('span', {
                  style: {
                    width: 7, height: 7, borderRadius: '50%',
                    background: STATUS_COLORS[s], display: 'inline-block'
                  }
                }),
                jsxs('span', {
                  className: 'text-(--ui-text-secondary)',
                  children: [counts[s] || 0, ' ', s]
                })
              ]
            }, s))
          })
        ]
      }),
      jsxs('div', {
        style: {
          position: 'absolute', inset: 0, perspective: '1500px',
          perspectiveOrigin: '50% 42%'
        },
        children: [
          jsx('div', {
            style: {
              position: 'absolute', left: '50%', top: '48%',
              width: px(WORLD_W), height: px(WORLD_H),
              transform: `translate(-50%,-50%) scale(0.62) ${CAM}`,
              transformStyle: 'preserve-3d'
            },
            children: [
              // Floor plane
              jsx('div', {
                style: {
                  position: 'absolute', inset: 0, borderRadius: 26,
                  background: `linear-gradient(135deg, ${C.floorA}, ${C.floorB})`,
                  border: `1px solid ${C.edge}`,
                  backgroundImage:
                    `linear-gradient(${C.grid} 1px, transparent 1px), ` +
                    `linear-gradient(90deg, ${C.grid} 1px, transparent 1px), ` +
                    `radial-gradient(ellipse 55% 45% at 28% 22%, ${C.warm}, transparent 70%), ` +
                    `radial-gradient(ellipse 50% 45% at 72% 70%, ${C.cool}, transparent 70%), ` +
                    `linear-gradient(135deg, ${C.floorA}, ${C.floorB})`,
                  backgroundSize: `${UNIT / 2}px ${UNIT / 2}px, ${UNIT / 2}px ${UNIT / 2}px, 100% 100%, 100% 100%, 100% 100%`,
                  boxShadow: '0 0 60px rgba(56,189,248,0.06) inset'
                }
              }),
              // Glass partitions (back edges)
              jsx(Wall, { u: 0, v: 0, w: WORLD_W, rot: 0 }),
              jsx(Wall, { u: 0, v: 0, w: 0, rot: 1 }),
              // Meeting room (bottom-left)
              jsx('div', {
                style: {
                  position: 'absolute', left: px(0.7), top: px(4.4),
                  width: px(2.2), height: px(2.9), borderRadius: 18,
                  background: 'rgba(99,102,241,0.07)',
                  border: '1px solid rgba(129,140,248,0.22)', transform: 'translateZ(1px)'
                }
              }),
              jsx(Wall, { u: 0.7, v: 4.4, w: 2.2, rot: 0 }),
              jsx(Wall, { u: 0.7, v: 4.4, w: 0, rot: 1 }),
              jsx(Desk, { u: 1.15, v: 5.35, tint: '#818cf8', glow: false }),
              jsx(Desk, { u: 1.15, v: 6.15, tint: '#818cf8', glow: false }),
              jsx(RoomLabel, { u: 1.15, v: 4.62, text: 'Meeting room' }),
              // Coffee corner (top-left)
              jsx('div', {
                style: {
                  position: 'absolute', left: px(0.55), top: px(0.55),
                  width: px(1.9), height: px(1.7), borderRadius: 16,
                  background: 'rgba(251,191,36,0.06)',
                  border: '1px solid rgba(251,191,36,0.20)', transform: 'translateZ(1px)'
                }
              }),
              jsx(Desk, { u: 0.62, v: 0.72, tint: '#fbbf24', glow: false }),
              jsx(RoomLabel, { u: 0.85, v: 0.62, text: 'Coffee corner' }),
              // Server rack (top-right)
              jsx('div', {
                style: {
                  position: 'absolute', left: px(12.6), top: px(0.55),
                  width: px(1.15), height: px(1.2), borderRadius: 12,
                  background: 'rgba(15,23,42,0.85)', border: '1px solid rgba(56,189,248,0.25)',
                  transform: 'translateZ(2px)'
                }
              }),
              jsx(RoomLabel, { u: 12.62, v: 0.62, text: 'Server rack' }),
              // Desks (all agents)
              ...agents.map(a => {
                const spot = LAYOUT[a.name] || [2, 2]
                return jsx(Desk, {
                  u: spot[0], v: spot[1],
                  tint: STATUS_COLORS[a.status] || STATUS_COLORS.off,
                  glow: a.status === 'working'
                }, 'desk-' + a.name)
              }),
              // Avatars (depth-sorted)
              ...placed.map(p => jsx(Avatar, {
                a: p.a, u: p.u, v: p.v, avatars, onHover: setHover
              }, 'av-' + p.a.name))
            ]
          }),
          // Vignette
          jsx('div', {
            style: {
              position: 'absolute', inset: 0, pointerEvents: 'none',
              background: 'radial-gradient(ellipse 75% 65% at 50% 42%, transparent 55%, rgba(4,8,18,0.55) 100%)'
            }
          })
        ]
      }),
      // Hover panel
      hover ? jsxs('div', {
        className: 'absolute bottom-4 right-4 z-40 w-72 rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated, --ui-bg) p-3 text-xs shadow-xl',
        children: [
          jsxs('div', {
            className: 'flex items-center gap-2',
            children: [
              jsx('div', {
                style: {
                  width: 8, height: 8, borderRadius: '50%',
                  background: STATUS_COLORS[hover.status], display: 'inline-block'
                }
              }),
              jsx('div', {
                className: 'text-sm font-medium',
                children: `${hover.name} — ${hover.role}`
              })
            ]
          }),
          jsxs('div', {
            className: 'mt-2 flex flex-col gap-1 text-(--ui-text-secondary)',
            children: [
              jsx('div', { children: `status: ${hover.status} · ${hover.detail}` }),
              hover.current_task
                ? jsx('div', { children: `task: ${hover.current_task.id} — ${hover.current_task.title}` })
                : null,
              (hover.blocked_tasks || []).length
                ? jsx('div', {
                    children: `blocked on: ${hover.blocked_tasks.map(b => b.title).join(' · ')}`
                  })
                : null,
              jsx('div', {
                children: `queue: ${hover.queue || 0} · 24h tokens: ${fmtTok(hover.tokens_24h || 0)} · last active: ${hover.last_active || '?'}`
              })
            ]
          })
        ]
      }) : null
    ]
  })
}

export default {
  id: ID,
  name: 'Office 3D',
  defaultEnabled: false,
  register(c) {
    ctx = c
    c.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: PATH },
        render: () => jsx(OfficePage, {})
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        data: { path: PATH, label: 'Office 3D', codicon: 'organization' }
      },
      {
        id: 'palette',
        area: PALETTE_AREA,
        data: {
          id: 'open-office-3d',
          label: 'Open Office 3D',
          keywords: ['office', '3d', 'agents', 'team', 'floor', 'avatars', 'live'],
          run: () => host.navigate(PATH)
        }
      }
    ])
  }
}
