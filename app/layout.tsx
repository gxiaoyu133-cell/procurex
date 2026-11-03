import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata={title:'ProcureX · Procurement Workspace',description:'Review source evidence, compare landed costs and make a confident procurement decision.',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
