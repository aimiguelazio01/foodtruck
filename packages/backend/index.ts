export type OrderStatus='pending'|'confirmed'|'preparing'|'ready'|'collected'|'cancelled';
export type PaymentState='unpaid'|'paid_collection'|'demo_paid';
export interface CheckoutItem {id:string;quantity:number;extra?:boolean;variant?:boolean;optionIds?:string[]}
export interface CheckoutRequest {requestKey:string;name:string;contact:string;items:CheckoutItem[];pickupAt?:number;paymentMethod?:'collection'|'demo';expectedTotal?:number}
export interface CheckoutResponse {id:string}
export interface Credentials {email:string;password:string}
export interface OrderStatusChange {status:OrderStatus;version?:number}
export const transitions: Record<string, string[]> = {pending:['confirmed','cancelled'],confirmed:['preparing','cancelled'],preparing:['ready','cancelled'],ready:['collected','cancelled'],collected:[],cancelled:[]};

