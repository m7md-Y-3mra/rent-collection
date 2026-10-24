import { parseInstant } from '@/lib/instant';
export function formatSen(sen: number | bigint): string {
 const value=BigInt(sen), absolute=value<0n?-value:value;
 return `${value<0n?'-':''}RM ${(absolute/100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',')}.${(absolute%100n).toString().padStart(2,'0')}`;
}
export function formatBusinessDate(date: string): string {
 const [year,month,day]=date.split('-');
 return `${Number(day)} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(month)-1]} ${year}`;
}
export function formatMytDateTime(iso: string): string {
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso));
 const get=(type:string)=>parts.find(p=>p.type===type)!.value;
 return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} MYT`;
}
export function mytInputValue(now:Date):string {return new Date(now.getTime()+8*3600_000).toISOString().slice(0,16);}
export function mytLocalToIso(local:string):string|null {const match=/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})$/.exec(local);if(!match)return null;const iso=`${match[1]}T${match[2]}:${match[3]}:00+08:00`;return parseInstant(iso)?iso:null;}
export function lastSixMonths(now:Date):{from:string;to:string} {const to=mytInputValue(now).slice(0,7),[y,m]=to.split('-').map(Number),d=new Date(Date.UTC(y,m-6,1));return {from:d.toISOString().slice(0,7),to};}
export function validateReason(reason:string):string|null {return reason.length<5?'Reason must be at least 5 characters.':null;}
