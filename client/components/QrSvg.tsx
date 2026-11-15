import { useMemo } from 'react'
import { qrMatrix, qrPath } from '../qr'

interface QrSvgProps {
  text: string
  size?: number
  /** The small mark in the middle. Error correction H leaves room for it. */
  mark?: boolean
  label: string
}

/**
 * A crisp SVG QR. The path is one element for every dark module rather than a
 * rect per module, which keeps a sheet of ten labels light enough to print.
 */
export function QrSvg({ text, size = 132, mark = true, label }: QrSvgProps) {
  const matrix = useMemo(() => qrMatrix(text), [text])
  const quiet = 2
  const total = matrix.size + quiet * 2
  const path = useMemo(() => qrPath(matrix, quiet), [matrix])
  const centre = total / 2
  const markSize = total * 0.18

  return (
    <svg
      className="qr"
      width={size}
      height={size}
      viewBox={`0 0 ${total} ${total}`}
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <rect width={total} height={total} fill="#ffffff" />
      <path d={path} fill="#111111" shapeRendering="crispEdges" />
      {mark && (
        <g shapeRendering="geometricPrecision">
          <rect
            x={centre - markSize / 2}
            y={centre - markSize / 2}
            width={markSize}
            height={markSize}
            rx={markSize * 0.28}
            fill="#ffffff"
          />
          <text
            x={centre}
            y={centre}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={markSize * 0.72}
            fontWeight="700"
            fontFamily="system-ui, -apple-system, sans-serif"
            fill="#7a5c3e"
          >
            b
          </text>
        </g>
      )}
    </svg>
  )
}
