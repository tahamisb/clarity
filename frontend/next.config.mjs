/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root. Without this Turbopack walks up to the first
  // lockfile it finds (C:\Users\<you>\package-lock.json) and resolves
  // tailwindcss from there, which fails.
  turbopack: { root: import.meta.dirname },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
