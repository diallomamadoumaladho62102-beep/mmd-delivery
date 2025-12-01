/** @type {import('next').NextConfig} */
const nextConfig = {
  // autorise l’accès depuis ton LAN en dev
  allowedDevOrigins: ['http://192.168.1.203:3000'],
};
export default nextConfig;
