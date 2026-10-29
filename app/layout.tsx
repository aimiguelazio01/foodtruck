import 'leaflet/dist/leaflet.css';
import type { Metadata } from "next";
import "./styles.css";
import {RegisterPwa} from './pwa';

export const metadata: Metadata = { title: "Food Truck Live", description: "Gestão para negócios de comida de rua" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-PT" data-scroll-behavior="smooth"><body>{children}<RegisterPwa/></body></html>;
}
