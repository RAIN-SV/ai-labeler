"use client";

import * as XLSX from "xlsx";
import { LabelFile, FILE_TYPE_LABEL } from "../../lib/types";
import { Download } from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  pending: "待处理", uploading: "上传中", processing: "打标中", done: "完成", error: "出错",
};

interface Props { files: LabelFile[]; }

export default function BatchExport({ files }: Props) {
  const doneFiles = files.filter(f => f.status === "done" && f.result);
  if (doneFiles.length === 0) return null;

  const handleExport = () => {
    const rows = doneFiles.map(f => ({
      文件名: f.name,
      "【校验_文件名】": "",
      文件类型: FILE_TYPE_LABEL[f.fileType],
      "【校验_类型】": "",
      状态: STATUS_LABELS[f.status],
      打标结果: f.result ?? "",
      "【校验_打标结果】": "",
      转录文本: f.transcript ?? "",
      "【校验_转录文本】": "",
      Input_Tokens: f.inputTokens ?? 0,
      Output_Tokens: f.outputTokens ?? 0,
      合计_Tokens: (f.inputTokens ?? 0) + (f.outputTokens ?? 0),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [
      { wch: 30 }, { wch: 16 },  // 文件名 + 校验
      { wch: 8  }, { wch: 16 },  // 类型 + 校验
      { wch: 8  },               // 状态
      { wch: 80 }, { wch: 40 },  // 打标结果 + 校验
      { wch: 60 }, { wch: 40 },  // 转录文本 + 校验
      { wch: 12 }, { wch: 12 }, { wch: 12 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "打标结果");
    XLSX.writeFile(wb, `ai_labels_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <button onClick={handleExport} className="btn btn-primary" style={{ borderRadius: 10, fontSize: 12 }}>
      <Download size={12} />
      <span>Excel 导出</span>
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 17, height: 17, borderRadius: "50%",
        background: "rgba(255,255,255,0.25)", fontSize: 10, fontWeight: 700,
      }}>{doneFiles.length}</span>
    </button>
  );
}
