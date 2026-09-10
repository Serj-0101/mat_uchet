"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ColumnDef, flexRender, getCoreRowModel, getPaginationRowModel, useReactTable } from "@tanstack/react-table";
import { ArchiveRestore, ArrowDownAZ, ArrowLeft, ArrowUpAZ, ArrowUpDown, Check, ChevronLeft, ChevronRight, ClipboardList, Columns3, Download, FileDown, FileSpreadsheet, FolderArchive, History, Loader2, PackageCheck, Plus, RotateCcw, Search, Settings2, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import { assignRecordKeys, getComparisonBase } from "@/lib/asset-key";
import okofLookup from "@/public/okof-lookup.json";

type Asset = {
  id: number; sourceNumber: number; recordKey: string; comparisonKey?:string; inventoryNumber: string; name: string; account: string; custodian: string;
  okof: string; okofName: string; amortizationGroup: string; acceptedDate: string;
  quantity: number; balanceCost: number; depreciation: number; residualCost: number;
  note: string; issuedTo: string; issuedAt: string; issueNote: string;
  active: boolean; changeStatus: string;
};

type ImportAsset = Omit<Asset, "id" | "note" | "issuedTo" | "issuedAt" | "issueNote" | "active" | "changeStatus">;
type Movement = { id:number; action:string; recipient:string; eventDate:string; note:string; name:string; inventoryNumber:string };
type ParsedAccountingFile = {
  records: ImportAsset[]; workbookSheetCount: number; dataSheetCount: number;
  nonEmptyRows: number; skippedRows: number; duplicateRows: number;
};
type ComparisonGroup = { key:string; incomingCount:number; projectCount:number; added:ImportAsset[]; missing:Asset[] };
type Diff = ParsedAccountingFile & { groups:ComparisonGroup[]; added:ImportAsset[]; missing:Asset[]; changed:{row:ImportAsset;fields:string[]}[]; fileName:string };
type ArchiveEntry = { id:number; source_number:number|null; comparison_key:string; name:string; inventory_number:string; accepted_date:string; data_json:string; deleted_at:string; expires_at:string };
type SortState = { id:string; direction:"asc"|"desc" } | null;
type NewAssetDraft = { sourceNumber:string;name:string;inventoryNumber:string;acceptedDate:string;account:string;custodian:string;okof:string;quantity:string;balanceCost:string;depreciation:string;residualCost:string;note:string };

const currency = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 });
const statusLabels: Record<string, string> = { all:"Все", new:"Новые", changed:"Изменённые", issued:"Выдано" };
const fieldLabels: Record<string, string> = {
  sourceNumber:"№ строки", name:"Наименование", inventoryNumber:"Инвентарный №", custodian:"МОЛ", account:"Счёт", okof:"ОКОФ",
  okofName:"Наименование ОКОФ", amortizationGroup:"Аморт. группа", acceptedDate:"Принято к учёту",
  quantity:"Количество", balanceCost:"Балансовая стоимость", depreciation:"Амортизация", residualCost:"Остаточная стоимость",
  issuedTo:"Выдано", note:"Примечание", changeStatus:"Статус"
};
const defaultVisibility: Record<string, boolean> = {
  sourceNumber:true, name:true, inventoryNumber:true, custodian:true, account:false, okof:true, okofName:false, amortizationGroup:false,
  acceptedDate:true, quantity:false, balanceCost:true, depreciation:false, residualCost:true, issuedTo:true, note:true, changeStatus:true
};
const numericColumns = new Set(["sourceNumber","quantity","balanceCost","depreciation","residualCost"]);
const monetaryColumns = new Set(["balanceCost","depreciation","residualCost"]);
const emptyAsset:NewAssetDraft={sourceNumber:"",name:"",inventoryNumber:"",acceptedDate:"",account:"",custodian:"",okof:"",quantity:"1",balanceCost:"0",depreciation:"0",residualCost:"0",note:""};
function columnValue(asset:Asset, column:string) {
  const value=asset[column as keyof Asset];
  if(column==="changeStatus") return statusLabels[String(value)]||"В реестре";
  if(column==="issuedTo") return value?`выдано: ${String(value)}`:"";
  if(monetaryColumns.has(column)) return `${String(value??"")} ${currency.format(Number(value??0))}`;
  return String(value??"");
}
function normalizeHeader(value: unknown) { return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase(); }
function parseAccountingNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  let text = String(value ?? "").replace(/[\s\u00a0]/g, "").replace(/[^\d,().+-]/g, "");
  const negative = /^\(.*\)$/.test(text); text = text.replace(/[()]/g, "");
  const comma = text.lastIndexOf(","); const dot = text.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) text = comma > dot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  else if (comma >= 0) text = text.replace(/,/g, (match, offset) => offset === comma ? "." : "");
  const parsed = Number(text);
  return Number.isFinite(parsed) ? (negative ? -parsed : parsed) : 0;
}
function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = fileName; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function parseAccountingFile(file: File): Promise<ParsedAccountingFile> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type:"array", cellDates:false });
  const parsed: Omit<ImportAsset,"recordKey">[] = []; let dataSheetCount = 0; let nonEmptyRows = 0; let skippedRows = 0;
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header:1, defval:"", raw:false, blankrows:true });
    const headerIndexes = rows.flatMap((row, index) => row.some((cell) => normalizeHeader(cell) === "инвентарный номер") ? [index] : []);
    if (!headerIndexes.length) continue;
    dataSheetCount += 1;
    for (let section = 0; section < headerIndexes.length; section += 1) {
      const headerIndex = headerIndexes[section]; const endIndex = headerIndexes[section + 1] ?? rows.length;
      const compositeHeader = rows[headerIndex].map((cell, column) => normalizeHeader(cell || rows[headerIndex - 1]?.[column] || rows[headerIndex - 2]?.[column]));
      const findColumn = (...names: string[]) => compositeHeader.findIndex((cell) => names.some((name) => cell === normalizeHeader(name)));
      const nameCol = findColumn("Основное средство", "Наименование основного средства", "Наименование");
      const invCol = findColumn("Инвентарный номер", "Инвентарный №", "Инв. номер");
      const okofCol = findColumn("ОКОФ"); const dateCol = findColumn("Дата принятия к учету", "Дата принятия к учёту");
      const quantityCol = findColumn("Количество"); const balanceCol = findColumn("Балансовая стоимость");
      const depreciationCol = findColumn("Сумма амортизации", "Амортизация"); const residualCol = findColumn("Остаточная стоимость");
      if (nameCol < 0 || invCol < 0) continue;
      let account = ""; let custodian = "";
      for (const row of rows.slice(headerIndex + 1, endIndex)) {
        const hasValues = row.some((cell) => String(cell ?? "").trim()); if (!hasValues) continue; nonEmptyRows += 1;
        const first = String(row[0] ?? "").trim(); const compactFirst = first.replace(/[\s\u00a0]/g, "");
        const name = String(row[nameCol] ?? "").trim(); const inventoryNumber = String(row[invCol] ?? "").trim();
        if (!/^\d+$/.test(compactFirst)) {
          if (/^\d{3}\.\d{2},/.test(first)) account = first;
          else if (first && first !== "№ п/п" && !/^итого/i.test(first)) custodian = first;
          skippedRows += 1; continue;
        }
        const okof = okofCol >= 0 ? String(row[okofCol] ?? "").trim() : "";
        const lookup = (okofLookup as Record<string,{name:string;group:string}>)[okof];
        parsed.push({
          sourceNumber:Number(compactFirst), inventoryNumber, name, account, custodian, okof, okofName:lookup?.name ?? "", amortizationGroup:lookup?.group ?? "",
          acceptedDate:dateCol >= 0 ? String(row[dateCol] ?? "").trim() : "",
          quantity:quantityCol >= 0 ? parseAccountingNumber(row[quantityCol]) : 0,
          balanceCost:balanceCol >= 0 ? parseAccountingNumber(row[balanceCol]) : 0,
          depreciation:depreciationCol >= 0 ? parseAccountingNumber(row[depreciationCol]) : 0,
          residualCost:residualCol >= 0 ? parseAccountingNumber(row[residualCol]) : 0
        });
      }
    }
  }
  if (!dataSheetCount) throw new Error("Не найдена колонка «Инвентарный номер» ни на одном листе");
  if (!parsed.length) throw new Error("В файле нет пронумерованных строк учёта");
  const sourceNumbers = new Set<number>();
  for (const row of parsed) {
    if (sourceNumbers.has(row.sourceNumber)) throw new Error(`Номер ${row.sourceNumber} в столбце №1 встречается несколько раз`);
    sourceNumbers.add(row.sourceNumber);
  }
  parsed.sort((a,b)=>a.sourceNumber-b.sourceNumber);
  const records = assignRecordKeys(parsed);
  const duplicateRows = records.length - new Set(records.map((row)=>row.recordKey.replace(/#\d+$/, ""))).size;
  return { records, workbookSheetCount:workbook.SheetNames.length, dataSheetCount, nonEmptyRows, skippedRows, duplicateRows };
}

async function buildAct(items: Asset[], recipient: string, date: string) {
  const templateResponse = await fetch("/api/template");
  let blob: Blob;
  if (templateResponse.ok) {
    const [{ default:PizZip }, { default:Docxtemplater }] = await Promise.all([import("pizzip"), import("docxtemplater")]);
    const doc = new Docxtemplater(new PizZip(await templateResponse.arrayBuffer()), { paragraphLoop:true, linebreaks:true });
    doc.render({ дата:date, получатель:recipient, позиции:items.map((item, index) => ({ номер:index + 1, наименование:item.name, инвентарный_номер:item.inventoryNumber })) });
    blob = doc.getZip().generate({ type:"blob", mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  } else {
    const { AlignmentType, Document, Packer, Paragraph, Table:DocTable, TableCell, TableRow, TextRun, WidthType } = await import("docx");
    const tableRows = [
      new TableRow({ children:["№","Наименование основного средства","Инвентарный номер"].map((text) => new TableCell({ children:[new Paragraph({ children:[new TextRun({ text, bold:true })] })] })) }),
      ...items.map((item, index) => new TableRow({ children:[String(index + 1),item.name,item.inventoryNumber].map((text) => new TableCell({ children:[new Paragraph(text)] })) }))
    ];
    const document = new Document({ sections:[{ children:[
      new Paragraph({ alignment:AlignmentType.CENTER, children:[new TextRun({ text:"АКТ ВЫДАЧИ МАТЕРИАЛЬНЫХ СРЕДСТВ", bold:true, size:28 })] }),
      new Paragraph({ text:`Дата: ${date}`, spacing:{ before:240 } }), new Paragraph({ text:`Получатель: ${recipient}`, spacing:{ after:240 } }),
      new DocTable({ width:{ size:100, type:WidthType.PERCENTAGE }, rows:tableRows }),
      new Paragraph({ text:"Выдал: ____________________", spacing:{ before:520 } }), new Paragraph("Получил: ____________________")
    ] }] });
    blob = await Packer.toBlob(document);
  }
  downloadBlob(blob, `Акт_выдачи_${date}.docx`);
}

export default function Home() {
  const [assets, setAssets] = useState<Asset[]>([]); const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState<{loaded:number;total:number} | null>(null);
  const [query, setQuery] = useState(""); const [status, setStatus] = useState("all"); const [selected, setSelected] = useState<Set<number>>(new Set());
  const [columnFilters, setColumnFilters] = useState<Record<string,string>>({}); const [sortState, setSortState] = useState<SortState>(null);
  const [hiddenRows, setHiddenRows] = useState<Set<number>>(new Set()); const [visibility, setVisibility] = useState(defaultVisibility);
  const [view, setView] = useState<"registry"|"comparison"|"archive">("registry");
  const [diff, setDiff] = useState<Diff | null>(null); const [notes, setNotes] = useState<Record<string,string>>({}); const [selectedAdds, setSelectedAdds] = useState<Set<string>>(new Set()); const [selectedDeletes, setSelectedDeletes] = useState<Set<number>>(new Set()); const [applying, setApplying] = useState(false);
  const [archive, setArchive] = useState<ArchiveEntry[]>([]); const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveFrom,setArchiveFrom]=useState("");const [archiveTo,setArchiveTo]=useState("");const [archiveConfirm,setArchiveConfirm]=useState(false);const [archiveCleaning,setArchiveCleaning]=useState(false);
  const [addOpen,setAddOpen]=useState(false);const [newAsset,setNewAsset]=useState<NewAssetDraft>(emptyAsset);const [savingAsset,setSavingAsset]=useState(false);const [deleteCandidate,setDeleteCandidate]=useState<Asset|null>(null);const [deletingAsset,setDeletingAsset]=useState(false);
  const [operation, setOperation] = useState<{ asset:Asset; action:"issue"|"return" } | null>(null);
  const [recipient, setRecipient] = useState(""); const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0,10)); const [operationNote, setOperationNote] = useState("");
  const [actOpen, setActOpen] = useState(false); const [actRecipient, setActRecipient] = useState(""); const [movementsOpen, setMovementsOpen] = useState(false); const [movements, setMovements] = useState<Movement[]>([]);
  const importInput = useRef<HTMLInputElement>(null); const templateInput = useRef<HTMLInputElement>(null);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    try {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const response = await fetch("/api/assets");
        const data = await response.json() as { assets?:Asset[]; error?:string; initialization?:{complete:boolean;loaded:number;total:number} };
        if (response.status === 202 && data.initialization) { setLoadProgress(data.initialization); continue; }
        if (!response.ok) throw new Error(data.error);
        setAssets(data.assets ?? []); setLoadProgress(null); return;
      }
      throw new Error("Не удалось завершить подготовку полного реестра");
    }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось загрузить данные"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadAssets(); const saved = localStorage.getItem("material-columns"); if (saved) try { setVisibility({ ...defaultVisibility, ...JSON.parse(saved) }); } catch {} }, [loadAssets]);

  const counts = useMemo(() => ({
    all:assets.length, new:assets.filter(a=>a.changeStatus==="new").length, changed:assets.filter(a=>a.changeStatus==="changed").length,
    issued:assets.filter(a=>a.issuedTo).length
  }), [assets]);
  const filtered = useMemo(() => {
    const term=query.trim().toLocaleLowerCase("ru");
    const rows=assets.filter((asset) => {
      if(hiddenRows.has(asset.id)) return false;
      const matchesStatus=status==="all"||(status==="issued"?Boolean(asset.issuedTo):asset.changeStatus===status);
      const matchesGlobal=!term||[String(asset.sourceNumber),asset.name,asset.inventoryNumber,asset.custodian,asset.okof,asset.note,asset.issuedTo].some(value=>String(value??"").toLocaleLowerCase("ru").includes(term));
      const matchesColumns=Object.entries(columnFilters).every(([column,filter])=>!filter.trim()||columnValue(asset,column).toLocaleLowerCase("ru").includes(filter.trim().toLocaleLowerCase("ru")));
      return matchesStatus&&matchesGlobal&&matchesColumns;
    });
    if(!sortState)return rows;
    return [...rows].sort((left,right)=>{
      const leftValue=left[sortState.id as keyof Asset];const rightValue=right[sortState.id as keyof Asset];
      const result=numericColumns.has(sortState.id)?Number(leftValue??0)-Number(rightValue??0):String(leftValue??"").localeCompare(String(rightValue??""),"ru",{numeric:true,sensitivity:"base"});
      return sortState.direction==="asc"?result:-result;
    });
  }, [assets,columnFilters,hiddenRows,query,sortState,status]);

  const toggleSelected = (id:number) => setSelected((old) => { const next=new Set(old); if(next.has(id))next.delete(id);else next.add(id); return next; });
  const cycleSort = (id:string) => setSortState((old) => old?.id!==id?{id,direction:"asc"}:old.direction==="asc"?{id,direction:"desc"}:null);
  const columns = useMemo<ColumnDef<Asset>[]>(() => {
    const data: ColumnDef<Asset>[] = [
      { id:"select", header:()=><Checkbox aria-label="Выбрать все строки" checked={filtered.length>0 && filtered.every(a=>selected.has(a.id))} onCheckedChange={()=>setSelected(filtered.every(a=>selected.has(a.id))?new Set():new Set(filtered.map(a=>a.id)))} />, cell:({row})=><Checkbox aria-label={`Выбрать ${row.original.name}`} checked={selected.has(row.original.id)} onCheckedChange={()=>toggleSelected(row.original.id)} /> },
      { accessorKey:"sourceNumber", header:"№" },
      { accessorKey:"name", header:"Наименование", cell:({row})=><div className="asset-name"><strong>{row.original.name}</strong><span>{row.original.inventoryNumber || "Без инвентарного номера"}</span></div> },
      { accessorKey:"inventoryNumber", header:"Инвентарный №" }, { accessorKey:"custodian", header:"МОЛ" }, { accessorKey:"account", header:"Счёт" },
      { accessorKey:"okof", header:"ОКОФ" }, { accessorKey:"okofName", header:"Наименование ОКОФ" }, { accessorKey:"amortizationGroup", header:"Аморт. группа" },
      { accessorKey:"acceptedDate", header:"Принято к учёту" }, { accessorKey:"quantity", header:"Кол-во" },
      { accessorKey:"balanceCost", header:"Балансовая стоимость", cell:({getValue})=>currency.format(Number(getValue())) },
      { accessorKey:"depreciation", header:"Амортизация", cell:({getValue})=>currency.format(Number(getValue())) },
      { accessorKey:"residualCost", header:"Остаточная стоимость", cell:({getValue})=>currency.format(Number(getValue())) },
      { accessorKey:"issuedTo", header:"Выдано", cell:({row})=>row.original.issuedTo?<button className="issued-pill" onClick={()=>setOperation({asset:row.original,action:"return"})}><PackageCheck size={14}/>выдано: {row.original.issuedTo}</button>:<Button size="sm" variant="outline" onClick={()=>setOperation({asset:row.original,action:"issue"})}>Выдать</Button> },
      { accessorKey:"note", header:"Примечание", cell:({getValue})=><span className="muted-cell">{String(getValue()||"—")}</span> },
      { accessorKey:"changeStatus", header:"Статус", cell:({row})=><span className={`status-badge status-${row.original.active?row.original.changeStatus:"missing"}`}>{row.original.active?(statusLabels[row.original.changeStatus]||"В реестре"):"Отсутствует"}</span> },
      { id:"actions", header:"Действия", cell:({row})=><Button size="icon" variant="ghost" className="row-delete" aria-label={`Удалить запись №${row.original.sourceNumber}`} title="Удалить запись" onClick={()=>setDeleteCandidate(row.original)}><Trash2 size={16}/></Button> }
    ];
    return data;
  }, [filtered, selected]);
  const columnVisibility = useMemo(() => ({ select:true, actions:true, ...visibility }), [visibility]);
  const table = useReactTable({ data:filtered, columns, state:{ columnVisibility }, onColumnVisibilityChange:(updater)=>setVisibility((old)=>typeof updater==="function"?updater(old):updater), getCoreRowModel:getCoreRowModel(), getPaginationRowModel:getPaginationRowModel(), initialState:{ pagination:{ pageSize:50 } } });

  async function handleImport(file: File) {
    try {
      const parsed=await parseAccountingFile(file); const incomingGroups=new Map<string,ImportAsset[]>(); const projectGroups=new Map<string,Asset[]>();
      for(const row of parsed.records){const key=getComparisonBase(row);const group=incomingGroups.get(key)??[];group.push(row);incomingGroups.set(key,group);}
      for(const row of assets){const key=row.comparisonKey||getComparisonBase(row);const group=projectGroups.get(key)??[];group.push(row);projectGroups.set(key,group);}
      for(const group of projectGroups.values()) group.sort((a,b)=>(a.sourceNumber??a.id)-(b.sourceNumber??b.id));
      const groups:ComparisonGroup[]=[];
      for(const key of new Set([...incomingGroups.keys(),...projectGroups.keys()])){
        const incoming=incomingGroups.get(key)??[];const project=projectGroups.get(key)??[];const common=Math.min(incoming.length,project.length);
        if(incoming.length!==project.length) groups.push({key,incomingCount:incoming.length,projectCount:project.length,added:incoming.slice(common),missing:project.slice(common)});
      }
      groups.sort((a,b)=>Math.min(a.added[0]?.sourceNumber??Infinity,a.missing[0]?.sourceNumber??Infinity)-Math.min(b.added[0]?.sourceNumber??Infinity,b.missing[0]?.sourceNumber??Infinity));
      const added=groups.flatMap(group=>group.added);const missing=groups.flatMap(group=>group.missing);
      setNotes({});setSelectedAdds(new Set());setSelectedDeletes(new Set());setDiff({groups,added,missing,changed:[],fileName:file.name,...parsed});setView("comparison");
    } catch (error) { toast.error(error instanceof Error?error.message:"Файл не удалось прочитать"); }
    if (importInput.current) importInput.current.value="";
  }
  async function applyImport() {
    if(!diff)return; const empty=diff.added.filter(r=>selectedAdds.has(r.recordKey)&&!notes[r.recordKey]?.trim()); if(empty.length){ toast.error("Для каждой добавляемой записи требуется примечание"); return; }
    setApplying(true);
    try { const response=await fetch("/api/import/apply",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({fileName:diff.fileName,records:diff.records,addKeys:[...selectedAdds],deleteIds:[...selectedDeletes],notes})}); const data=await response.json() as {error?:string;added?:number;changed?:number;deleted?:number}; if(!response.ok)throw new Error(data.error); toast.success(`Сверка применена: добавлено ${data.added??0}, обновлено ${data.changed??0}, в архиве ${data.deleted??0}`); setDiff(null);setView("registry");await loadAssets(); }
    catch(error){toast.error(error instanceof Error?error.message:"Ошибка импорта");} finally{setApplying(false);}
  }
  async function loadArchive(){setArchiveLoading(true);try{const response=await fetch("/api/archive");const data=await response.json() as {archived?:ArchiveEntry[];error?:string};if(!response.ok)throw new Error(data.error);setArchive(data.archived??[]);}catch(error){toast.error(error instanceof Error?error.message:"Не удалось загрузить архив");}finally{setArchiveLoading(false);}}
  async function openArchive(){setView("archive");await loadArchive();}
  async function saveManualAsset(){
    if(!newAsset.sourceNumber||!newAsset.name.trim()||!newAsset.acceptedDate||!newAsset.note.trim()){toast.error("Заполните № строки, наименование, дату принятия и примечание");return;}
    setSavingAsset(true);try{const response=await fetch("/api/assets",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(newAsset)});const data=await response.json() as {error?:string};if(!response.ok)throw new Error(data.error);toast.success("Запись добавлена");setAddOpen(false);setNewAsset(emptyAsset);await loadAssets();}catch(error){toast.error(error instanceof Error?error.message:"Не удалось добавить запись");}finally{setSavingAsset(false);}
  }
  async function deleteManualAsset(){
    if(!deleteCandidate)return;setDeletingAsset(true);try{const response=await fetch(`/api/assets?id=${deleteCandidate.id}`,{method:"DELETE"});const data=await response.json() as {error?:string};if(!response.ok)throw new Error(data.error);toast.success("Запись перенесена в архив");setDeleteCandidate(null);await loadAssets();}catch(error){toast.error(error instanceof Error?error.message:"Не удалось удалить запись");}finally{setDeletingAsset(false);}
  }
  async function clearArchiveRange(){
    if(!archiveFrom||!archiveTo||archiveFrom>archiveTo){toast.error("Укажите корректный диапазон дат");return;}setArchiveCleaning(true);try{const response=await fetch("/api/archive",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({from:archiveFrom,to:archiveTo})});const data=await response.json() as {error?:string;deleted?:number};if(!response.ok)throw new Error(data.error);toast.success(`Безвозвратно удалено записей: ${data.deleted??0}`);setArchiveConfirm(false);await loadArchive();}catch(error){toast.error(error instanceof Error?error.message:"Не удалось очистить архив");}finally{setArchiveCleaning(false);}
  }
  async function saveOperation() {
    if(!operation)return;
    try { const response=await fetch("/api/movements",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({assetId:operation.asset.id,action:operation.action,recipient,eventDate,note:operationNote})}); const data=await response.json() as {error?:string}; if(!response.ok)throw new Error(data.error); if(operation.action==="issue") await buildAct([operation.asset],recipient,eventDate); toast.success(operation.action==="issue"?"Имущество выдано, акт сформирован":"Возврат зарегистрирован"); setOperation(null); setRecipient(""); setOperationNote(""); await loadAssets(); }
    catch(error){toast.error(error instanceof Error?error.message:"Операция не выполнена");}
  }
  async function openMovements() { setMovementsOpen(true); try{const r=await fetch("/api/movements");const d=await r.json() as {movements?:Movement[]};setMovements(d.movements??[]);}catch{toast.error("Не удалось загрузить журнал");} }
  async function uploadTemplate(file: File) { const r=await fetch("/api/template",{method:"POST",headers:{"content-type":file.type||"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},body:file}); if(r.ok)toast.success("Шаблон акта сохранён");else toast.error("Не удалось сохранить шаблон"); if(templateInput.current)templateInput.current.value=""; }
  async function exportExcel() { const XLSX=await import("xlsx"); const keys=Object.keys(visibility).filter(k=>visibility[k]); const rows=filtered.map(a=>Object.fromEntries(keys.map(k=>[fieldLabels[k],k==="issuedTo"&&a.issuedTo?`выдано: ${a.issuedTo}`:a[k as keyof Asset]]))); const sheet=XLSX.utils.json_to_sheet(rows); const book=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book,sheet,"Материальный учёт"); XLSX.writeFile(book,`Материальный_учет_${new Date().toISOString().slice(0,10)}.xlsx`); }
  const selectedAssets=assets.filter(a=>selected.has(a.id));

  if(view==="comparison"&&diff){
    const selectedWithoutNote=diff.added.some(row=>selectedAdds.has(row.recordKey)&&!notes[row.recordKey]?.trim());
    return <div className="app-shell"><Toaster position="top-right" richColors/><header className="topbar"><div className="brand"><span className="brand-mark"><ArchiveRestore size={21}/></span><div><h1>Материальный учёт</h1><p>Сверка загружаемой таблицы</p></div></div><Button variant="outline" onClick={()=>{setDiff(null);setView("registry");}}><ArrowLeft size={16}/>Вернуться в реестр</Button></header>
      <main className="workspace comparison-workspace"><section className="comparison-hero"><div><span className="eyebrow">Загрузка таблицы</span><h2>Сверка по ключу 3 + 7 + 9</h2><p>{diff.fileName} · {diff.records.length.toLocaleString("ru-RU")} строк. Совпадение определяется только полным совпадением наименования, инвентарного номера и даты принятия к учёту.</p></div><div className="comparison-actions"><Button variant="outline" onClick={()=>{setDiff(null);setView("registry");}}>Отмена</Button><Button disabled={applying||selectedWithoutNote} onClick={()=>void applyImport()}>{applying?<Loader2 className="spin"/>:<Check size={16}/>}Применить выбранное</Button></div></section>
      <section className="comparison-summary"><div><span>В файле</span><strong>{diff.records.length}</strong></div><div><span>В проекте</span><strong>{assets.length}</strong></div><div className="new"><span>Новых строк</span><strong>{diff.added.length}</strong></div><div className="missing"><span>Лишних строк</span><strong>{diff.missing.length}</strong></div></section>
      {diff.added.length>0&&<div className="comparison-alert new">В загружаемой таблице обнаружены новые записи. Выберите строки, которые нужно добавить, и заполните примечание.</div>}
      {diff.missing.length>0&&<div className="comparison-alert missing">В загружаемой таблице отсутствуют записи, которые есть в проекте. Выберите строки для переноса в архив.</div>}
      {!diff.groups.length?<section className="comparison-empty"><PackageCheck size={32}/><h3>Состав таблиц совпадает</h3><p>Различий в количестве строк по ключам 3+7+9 не обнаружено. При применении обновятся бухгалтерские поля совпавших записей.</p></section>:<section className="comparison-groups">{diff.groups.map(group=>{let parts=["","",""];try{parts=JSON.parse(group.key);}catch{}return <article className="comparison-group" key={group.key}><div className="comparison-group-head"><div><span>Ключ группы</span><h3>{parts[0]||"Без наименования"}</h3><p>№7: {parts[1]||"пусто"} · №9: {parts[2]||"пусто"}</p></div><div className="group-counts"><span>Проект <strong>{group.projectCount}</strong></span><span>Файл <strong>{group.incomingCount}</strong></span></div></div>
          {group.added.length>0&&<div className="comparison-list"><h4>Есть новые осн. средства в группе</h4>{group.added.map(row=><div className="comparison-row" key={row.recordKey}><Checkbox checked={selectedAdds.has(row.recordKey)} onCheckedChange={()=>setSelectedAdds(old=>{const next=new Set(old);if(next.has(row.recordKey))next.delete(row.recordKey);else next.add(row.recordKey);return next;})}/><div className="comparison-row-data"><strong>Строка №{row.sourceNumber}: {row.name}</strong><span>Инвентарный №: {row.inventoryNumber||"пусто"} · Принято: {row.acceptedDate||"пусто"}</span></div><Textarea disabled={!selectedAdds.has(row.recordKey)} value={notes[row.recordKey]??""} onChange={e=>setNotes(old=>({...old,[row.recordKey]:e.target.value}))} placeholder="Примечание обязательно при добавлении *"/></div>)}</div>}
          {group.missing.length>0&&<div className="comparison-list"><h4>В группе осн. средств меньше на {group.missing.length} строк.</h4>{group.missing.map(row=><div className="comparison-row delete" key={row.id}><Checkbox checked={selectedDeletes.has(row.id)} onCheckedChange={()=>setSelectedDeletes(old=>{const next=new Set(old);if(next.has(row.id))next.delete(row.id);else next.add(row.id);return next;})}/><div className="comparison-row-data"><strong>Строка №{row.sourceNumber}: {row.name}</strong><span>Инвентарный №: {row.inventoryNumber||"пусто"} · Принято: {row.acceptedDate||"пусто"}</span></div><span className="archive-hint">В архив на 1 год</span></div>)}</div>}</article>})}</section>}
      </main></div>;
  }

  if(view==="archive") return <div className="app-shell"><Toaster position="top-right" richColors/>
    <header className="topbar"><div className="brand"><span className="brand-mark"><FolderArchive size={21}/></span><div><h1>Архив удалённых записей</h1><p>Хранение в течение 1 года</p></div></div><Button variant="outline" onClick={()=>setView("registry")}><ArrowLeft size={16}/>Вернуться в реестр</Button></header>
    <main className="workspace"><section className="registry-card archive-card"><div className="registry-toolbar archive-toolbar"><div><h2>Удалённые основные средства</h2><p>{archive.length.toLocaleString("ru-RU")} записей; просроченные записи удаляются автоматически</p></div><div className="archive-cleanup"><span>Очистить с</span><Input type="date" aria-label="Начальная дата очистки архива" value={archiveFrom} onChange={event=>setArchiveFrom(event.target.value)}/><span>по</span><Input type="date" aria-label="Конечная дата очистки архива" value={archiveTo} onChange={event=>setArchiveTo(event.target.value)}/><Button variant="destructive" disabled={!archiveFrom||!archiveTo||archiveFrom>archiveTo} onClick={()=>setArchiveConfirm(true)}><Trash2 size={16}/>Очистить</Button></div></div>
      <div className="table-wrap"><Table><TableHeader><TableRow><TableHead>Удалено</TableHead><TableHead>Хранится до</TableHead><TableHead>№ строки</TableHead><TableHead>Наименование (№3)</TableHead><TableHead>Инвентарный № (№7)</TableHead><TableHead>Принято к учёту (№9)</TableHead><TableHead>Ключ 3+7+9</TableHead></TableRow></TableHeader><TableBody>{archiveLoading?<TableRow><TableCell colSpan={7}><div className="loading-state"><Loader2 className="spin"/>Загружаем архив…</div></TableCell></TableRow>:archive.length?archive.map(row=><TableRow key={row.id}><TableCell>{row.deleted_at}</TableCell><TableCell>{row.expires_at}</TableCell><TableCell>{row.source_number??"—"}</TableCell><TableCell><strong>{row.name}</strong></TableCell><TableCell>{row.inventory_number||"—"}</TableCell><TableCell>{row.accepted_date||"—"}</TableCell><TableCell><code className="key-code">{row.comparison_key}</code></TableCell></TableRow>):<TableRow><TableCell colSpan={7}><div className="empty-state">В архиве пока нет записей</div></TableCell></TableRow>}</TableBody></Table></div>
    </section></main>
    <AlertDialog open={archiveConfirm} onOpenChange={setArchiveConfirm}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Безвозвратно очистить архив?</AlertDialogTitle><AlertDialogDescription>Будут окончательно удалены все архивные записи с датой удаления от {archiveFrom} по {archiveTo} включительно. Операцию нельзя отменить.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={archiveCleaning}>Отмена</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={archiveCleaning} onClick={event=>{event.preventDefault();void clearArchiveRange();}}>{archiveCleaning?<Loader2 className="spin"/>:<Trash2/>}Удалить безвозвратно</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;

  return <div className="app-shell">
    <Toaster position="top-right" richColors />
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><ArchiveRestore size={21}/></span><div><h1>Материальный учёт</h1><p>МБОУ «Лицей № 35»</p></div></div>
      <div className="header-actions">
        <input ref={importInput} className="sr-only" type="file" accept=".xlsx" onChange={e=>e.target.files?.[0]&&void handleImport(e.target.files[0])}/>
        <Button className="primary-action" onClick={()=>importInput.current?.click()}><Upload size={16}/>Загрузить таблицу</Button>
        <Button variant="outline" onClick={()=>void openArchive()}><FolderArchive size={16}/>Архив</Button>
        <Button variant="outline" onClick={()=>void exportExcel()}><Download size={16}/>Excel</Button>
      </div>
    </header>

    <main className="workspace">
      <section className="summary-grid" aria-label="Сводка">
        <div className="summary-main"><span>Записей в реестре</span><strong>{assets.filter(a=>a.active).length.toLocaleString("ru-RU")}</strong><small>по столбцу №1 бухгалтерии</small></div>
        <div className="summary-card"><span>Балансовая стоимость</span><strong>{currency.format(assets.filter(a=>a.active).reduce((s,a)=>s+a.balanceCost,0))}</strong></div>
        <div className="summary-card"><span>Выдано</span><strong>{counts.issued}</strong><small>{counts.issued?"объектов у сотрудников":"всё на хранении"}</small></div>
        <div className="summary-card attention"><span>Требуют внимания</span><strong>{counts.new+counts.changed}</strong><small>после последней сверки</small></div>
      </section>

      <section className="registry-card">
        <div className="registry-toolbar">
          <div><h2>Реестр основных средств</h2><p>{filtered.length.toLocaleString("ru-RU")} записей в текущем представлении</p></div>
          <div className="toolbar-actions">
            <Button onClick={()=>setAddOpen(true)}><Plus size={16}/>Добавить запись</Button>
            <Button variant="outline" onClick={()=>void openMovements()}><History size={16}/>Журнал выдачи</Button>
            <input ref={templateInput} className="sr-only" type="file" accept=".docx" onChange={e=>e.target.files?.[0]&&void uploadTemplate(e.target.files[0])}/>
            <Button variant="outline" onClick={()=>templateInput.current?.click()}><FileDown size={16}/>Шаблон акта</Button>
            <Sheet><SheetTrigger asChild><Button variant="outline"><Settings2 size={16}/>Конструктор</Button></SheetTrigger><SheetContent className="builder-sheet"><SheetHeader><SheetTitle>Конструктор представления</SheetTitle><SheetDescription>Настройте состав выгрузки и скройте ненужные строки.</SheetDescription></SheetHeader><div className="builder-section"><h3><Columns3 size={16}/>Столбцы</h3>{Object.keys(defaultVisibility).map(key=><label className="builder-option" key={key}><Checkbox checked={visibility[key]} onCheckedChange={(checked)=>{const isVisible=Boolean(checked);const next={...visibility,[key]:isVisible};setVisibility(next);if(!isVisible){setColumnFilters(old=>{const copy={...old};delete copy[key];return copy;});setSortState(old=>old?.id===key?null:old);}localStorage.setItem("material-columns",JSON.stringify(next));}}/><span>{fieldLabels[key]}</span></label>)}</div><div className="builder-section"><h3>Строки</h3><Button variant="outline" disabled={!selected.size} onClick={()=>{setHiddenRows(new Set([...hiddenRows,...selected]));setSelected(new Set());}}><X size={15}/>Скрыть выбранные ({selected.size})</Button><Button variant="ghost" disabled={!hiddenRows.size} onClick={()=>setHiddenRows(new Set())}><RotateCcw size={15}/>Показать скрытые ({hiddenRows.size})</Button></div><div className="builder-footer"><Button className="w-full" onClick={()=>void exportExcel()}><FileSpreadsheet size={16}/>Выгрузить результат</Button></div></SheetContent></Sheet>
          </div>
        </div>
        <div className="filter-row">
          <Tabs value={status} onValueChange={setStatus}><TabsList>{Object.entries(statusLabels).map(([key,label])=><TabsTrigger key={key} value={key}>{label}<span>{counts[key as keyof typeof counts]}</span></TabsTrigger>)}</TabsList></Tabs>
          <div className="search-box"><Search size={17}/><Input aria-label="Поиск по реестру" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Название, номер, МОЛ…"/></div>
        </div>
        {selected.size>0&&<div className="selection-bar"><span>Выбрано: <strong>{selected.size}</strong></span><Button size="sm" variant="secondary" onClick={()=>setActOpen(true)}><ClipboardList size={15}/>Сформировать акт</Button><Button size="sm" variant="ghost" onClick={()=>setSelected(new Set())}>Снять выбор</Button></div>}
        <div className="table-wrap">
          <Table><TableHeader>{table.getHeaderGroups().map(group=><TableRow key={group.id}>{group.headers.map(header=><TableHead key={header.id}>{header.isPlaceholder?null:["select","actions"].includes(header.column.id)?flexRender(header.column.columnDef.header,header.getContext()):<div className="column-header"><span className="column-title">{flexRender(header.column.columnDef.header,header.getContext())}</span><div className="column-tools"><label className="column-search"><Search size={13}/><input value={columnFilters[header.column.id]??""} onChange={event=>setColumnFilters(old=>({...old,[header.column.id]:event.target.value}))} aria-label={`Поиск по столбцу «${fieldLabels[header.column.id]??header.column.id}»`} placeholder="Поиск"/></label><button type="button" className={`column-sort ${sortState?.id===header.column.id?"active":""}`} onClick={()=>cycleSort(header.column.id)} aria-label={`Сортировка столбца «${fieldLabels[header.column.id]??header.column.id}»: ${sortState?.id!==header.column.id?"не задана":sortState.direction==="asc"?"по возрастанию":"по убыванию"}`} title={sortState?.id!==header.column.id?"Сортировать по возрастанию":sortState.direction==="asc"?"Сортировать по убыванию":"Отменить сортировку"}>{sortState?.id!==header.column.id?<ArrowUpDown size={15}/>:sortState.direction==="asc"?<ArrowDownAZ size={15}/>:<ArrowUpAZ size={15}/>}</button></div></div>}</TableHead>)}</TableRow>)}</TableHeader>
          <TableBody>{loading?<TableRow><TableCell colSpan={columns.length}><div className="loading-state"><Loader2 className="spin"/>{loadProgress?`Подготавливаем полный реестр: ${loadProgress.loaded.toLocaleString("ru-RU")} из ${loadProgress.total.toLocaleString("ru-RU")}`:"Загружаем реестр…"}</div></TableCell></TableRow>:table.getRowModel().rows.length?table.getRowModel().rows.map(row=><TableRow key={row.id} data-state={selected.has(row.original.id)?"selected":undefined}>{row.getVisibleCells().map(cell=><TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell,cell.getContext())}</TableCell>)}</TableRow>):<TableRow><TableCell colSpan={columns.length}><div className="empty-state">По заданным условиям записей нет</div></TableCell></TableRow>}</TableBody></Table>
        </div>
        <div className="pagination"><span>Страница {table.getState().pagination.pageIndex+1} из {Math.max(table.getPageCount(),1)}</span><Button size="icon" variant="outline" aria-label="Предыдущая страница" disabled={!table.getCanPreviousPage()} onClick={()=>table.previousPage()}><ChevronLeft/></Button><Button size="icon" variant="outline" aria-label="Следующая страница" disabled={!table.getCanNextPage()} onClick={()=>table.nextPage()}><ChevronRight/></Button></div>
      </section>
    </main>

    <Dialog open={Boolean(diff)} onOpenChange={(open)=>!open&&setDiff(null)}><DialogContent className="review-dialog"><DialogHeader><DialogTitle>Результат сверки</DialogTitle><DialogDescription>{diff?.fileName}: загружено {diff?.records.length.toLocaleString("ru-RU")} пронумерованных строк; служебных строк пропущено {diff?.skippedRows.toLocaleString("ru-RU")}. Сравнение выполнено по столбцам №3 + №7 + №9.</DialogDescription></DialogHeader>{diff&&<div className="review-body"><div className="review-stats"><div className="new"><strong>{diff.added.length}</strong><span>новых</span></div><div className="changed"><strong>{diff.changed.length}</strong><span>изменено</span></div><div className="missing"><strong>{diff.missing.length}</strong><span>отсутствует</span></div></div>{diff.added.length>0&&<section className="review-section"><h3>Новые записи — примечание обязательно</h3>{diff.added.map(row=><div className="new-row" key={row.recordKey}><div><strong>№ {row.sourceNumber}. {row.name}</strong><span>{row.inventoryNumber || "Без инвентарного номера"}</span></div><Textarea aria-label={`Примечание для строки ${row.sourceNumber}`} value={notes[row.recordKey]??""} onChange={e=>setNotes({...notes,[row.recordKey]:e.target.value})} placeholder="Укажите причину или источник поступления *"/></div>)}</section>}{diff.changed.length>0&&<section className="review-section"><h3>Изменённые записи</h3>{diff.changed.slice(0,100).map(({row,fields})=><div className="change-row" key={row.recordKey}><div><strong>№ {row.sourceNumber}. {row.name}</strong><span>{row.inventoryNumber || "Без инвентарного номера"}</span></div><span>{fields.map(f=>fieldLabels[f]).join(", ")}</span></div>)}</section>}{diff.missing.length>0&&<section className="review-section"><h3>Нет в новом файле</h3>{diff.missing.slice(0,100).map(row=><div className="change-row" key={row.id}><div><strong>№ {row.sourceNumber}. {row.name}</strong><span>{row.inventoryNumber || "Без инвентарного номера"}</span></div><span>Запись останется в истории</span></div>)}</section>}</div>}<DialogFooter><Button variant="outline" onClick={()=>setDiff(null)}>Отмена</Button><Button disabled={applying||Boolean(diff?.added.some(r=>!notes[r.recordKey]?.trim()))} onClick={()=>void applyImport()}>{applying?<Loader2 className="spin"/>:<Check/>}Применить изменения</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={addOpen} onOpenChange={(open)=>{setAddOpen(open);if(!open)setNewAsset(emptyAsset);}}><DialogContent className="add-dialog"><DialogHeader><DialogTitle>Добавить запись</DialogTitle><DialogDescription>Новая строка будет добавлена в реестр. Поля со звёздочкой обязательны.</DialogDescription></DialogHeader><div className="add-field-grid">
      <label className="form-field"><span>№ строки *</span><Input type="number" min="1" value={newAsset.sourceNumber} onChange={event=>setNewAsset(old=>({...old,sourceNumber:event.target.value}))}/></label>
      <label className="form-field wide"><span>Наименование (столбец №3) *</span><Input value={newAsset.name} onChange={event=>setNewAsset(old=>({...old,name:event.target.value}))}/></label>
      <label className="form-field"><span>Инвентарный № (столбец №7)</span><Input value={newAsset.inventoryNumber} onChange={event=>setNewAsset(old=>({...old,inventoryNumber:event.target.value}))}/></label>
      <label className="form-field"><span>Принято к учёту (столбец №9) *</span><Input type="date" value={newAsset.acceptedDate} onChange={event=>setNewAsset(old=>({...old,acceptedDate:event.target.value}))}/></label>
      <label className="form-field"><span>Счёт</span><Input value={newAsset.account} onChange={event=>setNewAsset(old=>({...old,account:event.target.value}))}/></label>
      <label className="form-field"><span>МОЛ</span><Input value={newAsset.custodian} onChange={event=>setNewAsset(old=>({...old,custodian:event.target.value}))}/></label>
      <label className="form-field"><span>ОКОФ</span><Input value={newAsset.okof} onChange={event=>setNewAsset(old=>({...old,okof:event.target.value}))}/></label>
      <label className="form-field"><span>Количество</span><Input type="number" step="any" value={newAsset.quantity} onChange={event=>setNewAsset(old=>({...old,quantity:event.target.value}))}/></label>
      <label className="form-field"><span>Балансовая стоимость</span><Input type="number" step="0.01" value={newAsset.balanceCost} onChange={event=>setNewAsset(old=>({...old,balanceCost:event.target.value}))}/></label>
      <label className="form-field"><span>Амортизация</span><Input type="number" step="0.01" value={newAsset.depreciation} onChange={event=>setNewAsset(old=>({...old,depreciation:event.target.value}))}/></label>
      <label className="form-field"><span>Остаточная стоимость</span><Input type="number" step="0.01" value={newAsset.residualCost} onChange={event=>setNewAsset(old=>({...old,residualCost:event.target.value}))}/></label>
      <label className="form-field wide"><span>Примечание *</span><Textarea value={newAsset.note} onChange={event=>setNewAsset(old=>({...old,note:event.target.value}))} placeholder="Причина или основание добавления"/></label>
    </div><DialogFooter><Button variant="outline" disabled={savingAsset} onClick={()=>setAddOpen(false)}>Отмена</Button><Button disabled={savingAsset||!newAsset.sourceNumber||!newAsset.name.trim()||!newAsset.acceptedDate||!newAsset.note.trim()} onClick={()=>void saveManualAsset()}>{savingAsset?<Loader2 className="spin"/>:<Plus/>}Добавить</Button></DialogFooter></DialogContent></Dialog>

    <AlertDialog open={Boolean(deleteCandidate)} onOpenChange={(open)=>!open&&setDeleteCandidate(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Удалить запись из реестра?</AlertDialogTitle><AlertDialogDescription>Строка №{deleteCandidate?.sourceNumber} «{deleteCandidate?.name}» будет перенесена в архив и будет храниться там 1 год.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={deletingAsset}>Отмена</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={deletingAsset} onClick={event=>{event.preventDefault();void deleteManualAsset();}}>{deletingAsset?<Loader2 className="spin"/>:<Trash2/>}Удалить в архив</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>

    <Dialog open={Boolean(operation)} onOpenChange={(open)=>!open&&setOperation(null)}><DialogContent><DialogHeader><DialogTitle>{operation?.action==="issue"?"Выдать материальное средство":"Принять обратно"}</DialogTitle><DialogDescription>{operation?.asset.name} · № {operation?.asset.inventoryNumber}</DialogDescription></DialogHeader>{operation?.action==="issue"&&<label className="form-field"><span>Кому выдано *</span><Input value={recipient} onChange={e=>setRecipient(e.target.value)} placeholder="ФИО или подразделение"/></label>}<label className="form-field"><span>Дата операции *</span><Input type="date" value={eventDate} onChange={e=>setEventDate(e.target.value)}/></label><label className="form-field"><span>Примечание</span><Textarea value={operationNote} onChange={e=>setOperationNote(e.target.value)} placeholder="Состояние, комплектность, основание"/></label><DialogFooter><Button variant="outline" onClick={()=>setOperation(null)}>Отмена</Button><Button disabled={operation?.action==="issue"&&!recipient.trim()} onClick={()=>void saveOperation()}>{operation?.action==="issue"?"Выдать и скачать акт":"Принять обратно"}</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={actOpen} onOpenChange={setActOpen}><DialogContent><DialogHeader><DialogTitle>Сформировать акт выдачи</DialogTitle><DialogDescription>В акт войдут {selectedAssets.length} выбранных позиций с наименованиями и инвентарными номерами.</DialogDescription></DialogHeader><label className="form-field"><span>Получатель *</span><Input value={actRecipient} onChange={e=>setActRecipient(e.target.value)} placeholder="ФИО или подразделение"/></label><label className="form-field"><span>Дата акта</span><Input type="date" value={eventDate} onChange={e=>setEventDate(e.target.value)}/></label><DialogFooter><Button variant="outline" onClick={()=>setActOpen(false)}>Отмена</Button><Button disabled={!actRecipient.trim()} onClick={async()=>{await buildAct(selectedAssets,actRecipient,eventDate);setActOpen(false);toast.success("Акт сформирован");}}>Скачать DOCX</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={movementsOpen} onOpenChange={setMovementsOpen}><DialogContent className="journal-dialog"><DialogHeader><DialogTitle>Журнал выдачи и возврата</DialogTitle><DialogDescription>Полная история операций в хронологическом порядке.</DialogDescription></DialogHeader><div className="journal-list">{movements.length?movements.map(m=><div className="journal-row" key={m.id}><span className={m.action==="issue"?"movement-issue":"movement-return"}>{m.action==="issue"?"Выдача":"Возврат"}</span><div><strong>{m.name}</strong><span>№ {m.inventoryNumber} · {m.recipient}</span></div><time>{m.eventDate}</time></div>):<div className="empty-state">Операций пока нет</div>}</div></DialogContent></Dialog>
  </div>;
}
