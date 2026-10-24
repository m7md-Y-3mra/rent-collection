import { parseRinggitToSen } from '@/lib/billing';
import { mytLocalToIso } from './format';
export function buildRecordPaymentBody(input:{amount:string;method:'cash'|'bank_transfer';receivedAtLocal:string;hasFile:boolean}):{ok:true;body:{amountSen:number;method:'cash'|'bank_transfer';receivedAt:string}}|{ok:false;errors:Partial<Record<'amount'|'receivedAt'|'slip',string>>} {
 const errors:Partial<Record<'amount'|'receivedAt'|'slip',string>>={};let amountSen=0;
 try {amountSen=parseRinggitToSen(input.amount);if(amountSen<=0)errors.amount='Amount must be more than 0.';}catch{errors.amount='Enter an amount like 1,500.50.';}
 const receivedAt=mytLocalToIso(input.receivedAtLocal);if(!receivedAt)errors.receivedAt='Enter a valid Malaysia date and time.';
 if(input.method==='bank_transfer'&&!input.hasFile)errors.slip='Attach the transfer slip.';
 return Object.keys(errors).length?{ok:false,errors}:{ok:true,body:{amountSen,method:input.method,receivedAt:receivedAt!}};
}
