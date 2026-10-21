import Image from "next/image"
export function Brand() {
  return (
    <span className="brand">
      <Image
        className="brand-light"
        src="/brand/movo-logo.png"
        alt="Movo"
        width={7369}
        height={2693}
        sizes="94px"
        priority
      />
      <Image
        className="brand-dark"
        src="/brand/movo-logo-dark.png"
        alt="Movo"
        width={7382}
        height={2693}
        sizes="94px"
        priority
      />
      <span>ADMIN</span>
    </span>
  )
}

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ height: size, width: size }}>
      <Image
        className="brand-light"
        src="/brand/movo-iso.png"
        alt="Movo"
        width={2683}
        height={2693}
        sizes={`${size}px`}
      />
      <Image
        className="brand-dark"
        src="/brand/movo-iso-dark.png"
        alt="Movo"
        width={2713}
        height={2693}
        sizes={`${size}px`}
      />
    </span>
  )
}
