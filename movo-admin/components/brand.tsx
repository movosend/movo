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
