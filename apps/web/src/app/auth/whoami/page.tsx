"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseBrowser";
export default function WhoAmI(){
  const [u,setU]=useState<any>(null);
  useEffect(()=>{(async()=>{const {data}=await supabase.auth.getUser(); setU(data.user??null);})();},[]);
  if(!u) return <div className="p-6">Non connecté.</div>;
  return (<div className="p-6 space-y-2"><div><b>User ID:</b> {u.id}</div><div><b>Email:</b> {u.email??"(aucun e-mail)"}</div></div>);
}


