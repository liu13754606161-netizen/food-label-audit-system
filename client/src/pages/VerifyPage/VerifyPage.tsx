import React, { useState, useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, XCircle, AlertTriangle, History, Eye, Trash2, Loader2, FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { getRecords, deleteRecord, getRecordById } from '@/api';
import { toast } from 'sonner';
import { logger } from '@lark-apaas/client-toolkit/logger';
import type { FoodInfo, FoodInfoItem, ManufacturerInfo, RecordItem } from '@shared/api.interface';

interface CompareResult {
  field: string;
  original: string;
  manual: string;
  match: boolean;
  choice: 'original' | 'manual';
}

interface FinalInfo {
  delegator: { name: string; address: string; phone: string };
  entrustedParty: {
    name: string;
    address: string;
    phone: string;
    license: string;
    origin: string;
  };
  rawMaterialSupplier: {
    name: string;
    address: string;
    phone: string;
    license: string;
    origin: string;
  };
  foodList: FoodInfoItem[];
  manufacturerList?: ManufacturerInfo[];
  compareResults: CompareResult[];
}

interface HistoryRecord {
  id: string;
  fileName: string;
  createdAt: string;
  foodInfo?: FoodInfo;
  foodList?: FoodInfoItem[];
  manufacturerInfo?: ManufacturerInfo;
  manufacturerList?: ManufacturerInfo[];
}

const hasText = (value: unknown) => String(value || '').trim().length > 0;

const hasManufacturerContent = (info?: ManufacturerInfo) =>
  Boolean(info && [
    info.rawMaterialSupplier?.name,
    info.rawMaterialSupplier?.address,
    info.rawMaterialSupplier?.phone,
    info.rawMaterialSupplier?.license,
    info.rawMaterialSupplier?.origin,
    info.delegator?.name,
    info.delegator?.address,
    info.delegator?.phone,
    info.entrustedParty?.name,
    info.entrustedParty?.address,
    info.entrustedParty?.phone,
    info.entrustedParty?.license,
    info.entrustedParty?.origin,
  ].some(hasText));

const manufacturerSignature = (info?: ManufacturerInfo) =>
  [
    info?.rawMaterialSupplier?.name,
    info?.rawMaterialSupplier?.address,
    info?.rawMaterialSupplier?.phone,
    info?.rawMaterialSupplier?.license,
    info?.rawMaterialSupplier?.origin,
    info?.delegator?.name,
    info?.delegator?.address,
    info?.delegator?.phone,
    info?.entrustedParty?.name,
    info?.entrustedParty?.address,
    info?.entrustedParty?.phone,
    info?.entrustedParty?.license,
    info?.entrustedParty?.origin,
  ].map((value) => String(value || '').trim()).join('|');

const uniqueManufacturerList = (list: ManufacturerInfo[] = []) => {
  const seen = new Set<string>();
  return list.filter((item) => {
    if (!hasManufacturerContent(item)) return false;
    const signature = manufacturerSignature(item);
    if (!signature || seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
};

interface NutritionRow {
  item: string;
  amount: string;
  nrv: string;
}

const parseNutritionRows = (value?: string): NutritionRow[] => {
  const source = String(value || '')
    .replace(/\r/g, '\n')
    .replace(/营养成分表\s*[：:]?/g, ' ')
    .replace(/每\s*100\s*克/g, '每100克')
    .trim();
  if (!source) return [];

  const nutrientRegex = /(饱和脂肪|反式脂肪|碳水化合物|膳食纤维|胆固醇|维生素[A-Z]?\d*|能量|蛋白质|脂肪|糖|钠|钙|铁|锌|烟酸)(?!素参考值)/g;
  const matches = Array.from(source.matchAll(nutrientRegex));
  if (matches.length < 2) return [];

  return matches
    .map((match, index) => {
      const item = match[1];
      const start = (match.index || 0) + item.length;
      const end = index + 1 < matches.length ? matches[index + 1].index || source.length : source.length;
      const raw = source.slice(start, end)
        .replace(/^[：:\s,，;；。]+/, '')
        .replace(/项目|每100克(?:\([^)]+\))?|每份|NRV%?|营养素参考值/gi, ' ')
        .replace(/[，,；;。]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!raw || /^(项目|每100克|NRV%?|营养素参考值)$/i.test(raw)) {
        return { item, amount: '', nrv: '' };
      }
      const nrvMatch = raw.match(/(\d+(?:\.\d+)?\s*%)/);
      const nrv = nrvMatch?.[1]?.replace(/\s+/g, '') || '';
      const amount = raw
        .replace(nrvMatch?.[0] || '', '')
        .replace(/\s+/g, ' ')
        .trim();
      return { item, amount, nrv };
    })
    .filter((row) => row.item && (row.amount || row.nrv));
};

const VerifyPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as {
    foodInfo?: FoodInfo;
    foodList?: FoodInfoItem[];
    manufacturerInfo?: ManufacturerInfo;
    manufacturerList?: ManufacturerInfo[];
    filename?: string;
  } | null;

  const manufacturerList: ManufacturerInfo[] = state?.manufacturerList?.length
    ? uniqueManufacturerList(state.manufacturerList)
    : state?.manufacturerInfo
      ? uniqueManufacturerList([state.manufacturerInfo])
      : [];
  const foodList: FoodInfoItem[] = state?.foodList?.length
    ? state.foodList
    : state?.foodInfo
      ? [{ ...state.foodInfo, title: '食品1' }]
      : [];

  const [manualDelegator, setManualDelegator] = useState({
    name: '',
    address: '',
    phone: '',
  });

  const [manualEntrusted, setManualEntrusted] = useState({
    name: '',
    address: '',
    phone: '',
    license: '',
    origin: '',
  });

  const [compareResults, setCompareResults] = useState<CompareResult[]>([]);
  const [hasCompared, setHasCompared] = useState(false);
  const [finalInfo, setFinalInfo] = useState<FinalInfo | null>(null);
  const [wordFilename, setWordFilename] = useState(state?.filename || '标签信息');

  // History state
  const [historyRecords, setHistoryRecords] = useState<HistoryRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [viewRecord, setViewRecord] = useState<HistoryRecord | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  // Load history records
  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const response = await getRecords({ type: 'audit', pageSize: 20 });
      if (response.items) {
        setHistoryRecords(
          response.items.map((item: RecordItem) => ({
            id: item.id,
            fileName: item.fileName,
            createdAt: item.createdAt,
            foodInfo: item.rawData?.foodInfo,
            foodList: item.rawData?.foodList,
            manufacturerInfo: item.rawData?.manufacturerInfo,
            manufacturerList: item.rawData?.manufacturerList,
          })),
        );
      }
    } catch (error) {
      logger.error('加载历史记录失败', error);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // View history record detail
  const handleViewHistory = async (record: HistoryRecord) => {
    setViewLoading(true);
    setViewRecord(null);
    try {
      const detail = await getRecordById(record.id);
      setViewRecord({
        id: detail.id,
        fileName: detail.fileName,
        createdAt: detail.createdAt,
        foodInfo: detail.rawData?.foodInfo,
        foodList: detail.rawData?.foodList,
        manufacturerInfo: detail.rawData?.manufacturerInfo,
        manufacturerList: detail.rawData?.manufacturerList,
      });
    } catch (error) {
      logger.error('获取记录详情失败', error);
      toast.error('获取记录详情失败');
    } finally {
      setViewLoading(false);
    }
  };

  // Delete history record
  const handleDeleteHistory = async (recordId: string) => {
    try {
      await deleteRecord(recordId);
      setHistoryRecords((prev) => prev.filter((r) => r.id !== recordId));
      toast.success('已删除');
    } catch (error) {
      logger.error('删除记录失败', error);
      toast.error('删除失败');
    }
  };

  const handleCompare = () => {
    const results: CompareResult[] = [];

    const firstMfg = manufacturerList[0];
    // 委托方对比
    const delegatorFields = [
      { field: '委托方名称', original: firstMfg?.delegator?.name || '', manual: manualDelegator.name },
      { field: '委托方地址', original: firstMfg?.delegator?.address || '', manual: manualDelegator.address },
      { field: '委托方电话', original: firstMfg?.delegator?.phone || '', manual: manualDelegator.phone },
    ];

    delegatorFields.forEach((item) => {
      results.push({
        field: item.field,
        original: item.original,
        manual: item.manual,
        match: item.original.trim() === item.manual.trim(),
        choice: item.original.trim() ? 'original' : 'manual',
      });
    });

    // 被委托方对比
    const entrustedFields = [
      { field: '被委托方名称', original: firstMfg?.entrustedParty?.name || '', manual: manualEntrusted.name },
      { field: '被委托方地址', original: firstMfg?.entrustedParty?.address || '', manual: manualEntrusted.address },
      { field: '被委托方电话', original: firstMfg?.entrustedParty?.phone || '', manual: manualEntrusted.phone },
      { field: '被委托方许可证', original: firstMfg?.entrustedParty?.license || '', manual: manualEntrusted.license },
      { field: '被委托方产地', original: firstMfg?.entrustedParty?.origin || '', manual: manualEntrusted.origin },
    ];

    entrustedFields.forEach((item) => {
      results.push({
        field: item.field,
        original: item.original,
        manual: item.manual,
        match: item.original.trim() === item.manual.trim(),
        choice: item.original.trim() ? 'original' : 'manual',
      });
    });

    setCompareResults(results);
    setHasCompared(true);
  };

  const mismatchCount = compareResults.filter((r) => !r.match).length;

  const handleChoiceChange = (index: number, choice: 'original' | 'manual') => {
    setCompareResults((prev) =>
      prev.map((r, i) => (i === index ? { ...r, choice } : r)),
    );
  };

  const handleConfirm = () => {
    const finalDelegator = { name: '', address: '', phone: '' };
    const finalEntrusted = {
      name: '',
      address: '',
      phone: '',
      license: '',
      origin: '',
    };
    const finalRawMaterial = {
      name: '',
      address: '',
      phone: '',
      license: '',
      origin: '',
    };

    const delegatorFieldMap: Record<string, keyof typeof finalDelegator> = {
      委托方名称: 'name',
      委托方地址: 'address',
      委托方电话: 'phone',
    };
    const entrustedFieldMap: Record<string, keyof typeof finalEntrusted> = {
      被委托方名称: 'name',
      被委托方地址: 'address',
      被委托方电话: 'phone',
      被委托方许可证: 'license',
      被委托方产地: 'origin',
    };
    const rawMaterialFieldMap: Record<string, keyof typeof finalRawMaterial> = {
      原料生产商名称: 'name',
      原料生产商地址: 'address',
      原料生产商电话: 'phone',
      原料生产商许可证: 'license',
      原料生产商产地: 'origin',
    };

    compareResults.forEach((r) => {
      const value = r.choice === 'original' ? r.original : r.manual;
      if (delegatorFieldMap[r.field]) {
        finalDelegator[delegatorFieldMap[r.field]] = value;
      }
      if (entrustedFieldMap[r.field]) {
        finalEntrusted[entrustedFieldMap[r.field]] = value;
      }
      if (rawMaterialFieldMap[r.field]) {
        finalRawMaterial[rawMaterialFieldMap[r.field]] = value;
      }
    });

    setFinalInfo({
      delegator: finalDelegator,
      entrustedParty: finalEntrusted,
      rawMaterialSupplier: finalRawMaterial,
      foodList,
      manufacturerList: manufacturerList.length > 0 ? manufacturerList : undefined,
      compareResults,
    });
    toast.success('信息已确认');
  };

  const escHtml = (val: string | undefined | string[]) => {
    if (Array.isArray(val)) return val.join('、') || '—';
    return val || '—';
  };

  const escWordHtml = (val: string | undefined | string[]) =>
    escHtml(val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const renderNutritionValue = (value?: string) => {
    const rows = parseNutritionRows(value);
    if (rows.length < 3) return escWordHtml(value);
    const hasNrv = rows.some((row) => row.nrv);
    return `
      <table class="nutrition-table" border="1" cellpadding="0" cellspacing="0">
        <tr>
          <th>项目</th>
          <th>每100克</th>
          ${hasNrv ? '<th>NRV%</th>' : ''}
        </tr>
        ${rows.map((row) => `
          <tr>
            <td>${escWordHtml(row.item)}</td>
            <td>${escWordHtml(row.amount)}</td>
            ${hasNrv ? `<td>${escWordHtml(row.nrv)}</td>` : ''}
          </tr>
        `).join('')}
      </table>
    `;
  };

  const buildTable = (fields: { label: string; value: string | undefined | string[] }[]) => {
    const rows = fields
      .map(
        (f) =>
          `<tr><td style="width:120px;padding:6px 8px;font-weight:bold;background:#f5f5f5;">${escWordHtml(f.label)}</td><td style="padding:6px 8px;">${f.label.includes('营养') ? renderNutritionValue(String(f.value || '')) : escWordHtml(f.value)}</td></tr>`,
      )
      .join('\n');
    return `<table border="1" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin-bottom:16px;border:1px solid #ddd;">${rows}</table>`;
  };

  const exportFinalInfoToWord = () => {
    if (!finalInfo) return;

    const { delegator, entrustedParty, rawMaterialSupplier, foodList, compareResults } = finalInfo;
    const sectionHasContent = (section: Record<string, string | undefined>) =>
      Object.values(section).some(hasText);
    const baseManufacturerList = uniqueManufacturerList(finalInfo.manufacturerList || []);
    const fallbackManufacturerList = uniqueManufacturerList([{
      rawMaterialSupplier,
      delegator,
      entrustedParty,
    }]);
    const finalManufacturerList = baseManufacturerList.length
      ? baseManufacturerList.map((item, index) => index === 0
        ? {
            rawMaterialSupplier: sectionHasContent(rawMaterialSupplier) ? rawMaterialSupplier : item.rawMaterialSupplier,
            delegator: sectionHasContent(delegator) ? delegator : item.delegator,
            entrustedParty: sectionHasContent(entrustedParty) ? entrustedParty : item.entrustedParty,
          }
        : item)
      : fallbackManufacturerList;
    const primaryManufacturer = finalManufacturerList[0] || {
      rawMaterialSupplier,
      delegator,
      entrustedParty,
    };

    // Part 1: Food info sections
    const foodSections = foodList
      .map((food, idx) => {
        const title = food.title || `食品${idx + 1}`;
        const fields = [
          { label: '产品名称', value: food.name },
          { label: '产品类型', value: food.type },
          { label: '净含量', value: food.netContent },
          { label: '配料', value: food.ingredients },
          { label: '保质期', value: food.shelfLife },
          { label: '储存条件', value: food.storageCondition },
          { label: '生产日期', value: food.productionDate },
          { label: '产品标准号', value: food.standardCode },
          { label: '营养成分', value: food.nutrition },
          { label: '过敏源', value: food.allergens },
          { label: '温馨提示', value: food.tips },
        ];
        return `<h2 style="font-size:14pt;font-weight:bold;margin:20px 0 8px;color:#1a365d;">${escWordHtml(title)}</h2>${buildTable(fields)}`;
      })
      .join('\n');

    // Part 2: Manufacturer info sections
    const hasMultiManufacturer = finalManufacturerList.length > 1;
    const manufacturerSections = finalManufacturerList.length
      ? (hasMultiManufacturer
      ? finalManufacturerList.map((m, idx) => {
          const title = `厂商${idx + 1}`;
          const rawMatFields = [
            { label: '名称', value: m.rawMaterialSupplier.name },
            { label: '地址', value: m.rawMaterialSupplier.address },
            { label: '电话', value: m.rawMaterialSupplier.phone },
            { label: '许可证', value: m.rawMaterialSupplier.license },
            { label: '产地', value: m.rawMaterialSupplier.origin },
          ];
          const delegatorFields = [
            { label: '名称', value: m.delegator.name },
            { label: '地址', value: m.delegator.address },
            { label: '电话', value: m.delegator.phone },
          ];
          const entrustedFields = [
            { label: '名称', value: m.entrustedParty.name },
            { label: '地址', value: m.entrustedParty.address },
            { label: '电话', value: m.entrustedParty.phone },
            { label: '许可证', value: m.entrustedParty.license },
            { label: '产地', value: m.entrustedParty.origin },
          ];
          return `
            <h2 style="font-size:14pt;font-weight:bold;margin:20px 0 8px;color:#1a365d;">${escWordHtml(title)}</h2>
            <h3 style="font-size:12pt;font-weight:bold;margin:12px 0 6px;color:#c53030;">原料生产商</h3>
            ${buildTable(rawMatFields)}
            <h3 style="font-size:12pt;font-weight:bold;margin:12px 0 6px;color:#2b6cb0;">委托方</h3>
            ${buildTable(delegatorFields)}
            <h3 style="font-size:12pt;font-weight:bold;margin:12px 0 6px;color:#d69e2e;">被委托方</h3>
            ${buildTable(entrustedFields)}
          `;
        }).join('\n')
      : `
          <h3 style="font-size:12pt;font-weight:bold;margin:12px 0 6px;color:#c53030;">原料生产商</h3>
          ${buildTable([
            { label: '名称', value: primaryManufacturer.rawMaterialSupplier.name },
            { label: '地址', value: primaryManufacturer.rawMaterialSupplier.address },
            { label: '电话', value: primaryManufacturer.rawMaterialSupplier.phone },
            { label: '许可证', value: primaryManufacturer.rawMaterialSupplier.license },
            { label: '产地', value: primaryManufacturer.rawMaterialSupplier.origin },
          ])}
          <h3 style="font-size:12pt;font-weight:bold;margin:12px 0 6px;color:#2b6cb0;">委托方</h3>
          ${buildTable([
            { label: '名称', value: primaryManufacturer.delegator.name },
            { label: '地址', value: primaryManufacturer.delegator.address },
            { label: '电话', value: primaryManufacturer.delegator.phone },
          ])}
          <h3 style="font-size:12pt;font-weight:bold;margin:12px 0 6px;color:#d69e2e;">被委托方</h3>
          ${buildTable([
            { label: '名称', value: primaryManufacturer.entrustedParty.name },
            { label: '地址', value: primaryManufacturer.entrustedParty.address },
            { label: '电话', value: primaryManufacturer.entrustedParty.phone },
            { label: '许可证', value: primaryManufacturer.entrustedParty.license },
            { label: '产地', value: primaryManufacturer.entrustedParty.origin },
          ])}
        `)
      : '<p style="color:#666;">未提取到厂商信息</p>';

    // Part 3: Compare results
    const compareSection = compareResults
      .map((r) => {
        const finalVal = r.choice === 'original' ? r.original : r.manual;
        return `<tr>
          <td style="padding:6px 8px;border:1px solid #ddd;">${escWordHtml(r.field)}</td>
          <td style="padding:6px 8px;border:1px solid #ddd;">${escWordHtml(r.original)}</td>
          <td style="padding:6px 8px;border:1px solid #ddd;">${escWordHtml(r.manual)}</td>
          <td style="padding:6px 8px;border:1px solid #ddd;font-weight:bold;">${r.choice === 'original' ? '使用原始' : '使用更新'}：${escWordHtml(finalVal)}</td>
        </tr>`;
      })
      .join('\n');

    const html = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
      <head>
        <meta charset="utf-8">
        <title>${escWordHtml(wordFilename || '食品标签核对信息')}</title>
        <style>
          body { font-family: 'Microsoft YaHei', 'Noto Sans SC', sans-serif; font-size: 10.5pt; color: #333; margin: 24px; }
          h1 { font-size: 18pt; font-weight: bold; color: #1a365d; margin-bottom: 16px; border-bottom: 2px solid #1a365d; padding-bottom: 8px; }
          h2 { font-size: 14pt; font-weight: bold; margin: 20px 0 8px; color: #1a365d; }
          h3 { font-size: 12pt; font-weight: bold; margin: 12px 0 6px; }
          table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
          td { padding: 6px 8px; border: 1px solid #ddd; }
          .section { margin-bottom: 24px; }
          .nutrition-table { border-collapse: collapse; width: 100%; margin: 0; }
          .nutrition-table th, .nutrition-table td { border: 1px solid #ddd; padding: 5px 8px; text-align: center; }
          .nutrition-table th { background: #f5f5f5; font-weight: bold; }
        </style>
      </head>
      <body>
        <h1>食品标签核对信息</h1>

        <div class="section">
          <h2>第一部分：食品信息</h2>
          ${foodSections}
        </div>

        <div class="section">
          <h2>第二部分：厂商信息</h2>
          ${manufacturerSections}
        </div>

        <div class="section">
          <h2>第三部分：核对结果</h2>
          <table border="1" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">
            <tr style="background:#f5f5f5;">
              <th style="padding:8px;border:1px solid #ddd;text-align:left;">字段</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:left;">原始提取</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:left;">手动输入</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:left;">最终选择</th>
            </tr>
            ${compareSection}
          </table>
        </div>
      </body>
      </html>
    `;

    const blob = new Blob([html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${wordFilename || '食品标签核对信息'}.doc`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('导出成功');
  };

  if (foodList.length === 0) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Card>
          <CardContent className="p-8 text-center">
            <AlertTriangle className="size-12 mx-auto mb-4 text-warning" />
            <h2 className="text-lg font-semibold mb-2">缺少数据</h2>
            <p className="text-sm text-muted-foreground mb-4">
              请先在标签内容展示页面提取或填写食品信息后点击「核对」按钮
            </p>
            <Button onClick={() => navigate('/generate')}>
              返回标签内容展示
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="size-4 mr-1" />
          返回
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">二次核对</h1>
          <p className="text-sm text-muted-foreground mt-1">
            对比原始提取信息与手动输入信息，确保数据准确
          </p>
        </div>
      </div>

      {/* 原始提取信息 - 只读 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">原始提取信息（只读）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 食品信息 */}
          {foodList.map((food, idx) => (
            <div key={idx} className={idx > 0 ? 'border-t pt-6 mt-6' : ''}>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                {food.title || `食品${idx + 1}`}
              </h3>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-xs text-muted-foreground block">产品名称</span>
                  <span>{food.name || '—'}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">产品类型</span>
                  <span>{food.type || '—'}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">净含量</span>
                  <span>{food.netContent || '—'}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">配料</span>
                  <span className="line-clamp-2">{food.ingredients || '—'}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">保质期</span>
                  <span>{food.shelfLife || '—'}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">储存条件</span>
                  <span>{food.storageCondition || '—'}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">生产日期</span>
                  <span>{food.productionDate || '—'}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">产品标准号</span>
                  <span>{food.standardCode || '—'}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">营养成分</span>
                  <span className="line-clamp-2">{food.nutrition || '—'}</span>
                </div>
              </div>
            </div>
          ))}

          {manufacturerList.slice(0, 1).map((mfg, idx) => (
            <div key={idx}>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                厂商信息
              </h3>
              <div className="grid grid-cols-2 gap-6">
                {/* 原料生产商 */}
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-red-600 uppercase">原料生产商</h4>
                  <div className="text-sm space-y-1">
                    <div>
                      <span className="text-xs text-muted-foreground">名称：</span>
                      <span>{mfg.rawMaterialSupplier.name || '—'}</span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">地址：</span>
                      <span>{mfg.rawMaterialSupplier.address || '—'}</span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">电话：</span>
                      <span>{mfg.rawMaterialSupplier.phone || '—'}</span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">许可证：</span>
                      <span>{mfg.rawMaterialSupplier.license || '—'}</span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">产地：</span>
                      <span>{mfg.rawMaterialSupplier.origin || '—'}</span>
                    </div>
                  </div>
                </div>

                {/* 委托方 */}
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-blue-600 uppercase">委托方</h4>
                  <div className="text-sm space-y-1">
                    <div>
                      <span className="text-xs text-muted-foreground">名称：</span>
                      <span>{mfg.delegator.name || '—'}</span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">地址：</span>
                      <span>{mfg.delegator.address || '—'}</span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">电话：</span>
                      <span>{mfg.delegator.phone || '—'}</span>
                    </div>
                  </div>
                </div>

                {/* 被委托方 */}
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-yellow-600 uppercase">被委托方</h4>
                  <div className="text-sm space-y-1">
                    <div>
                      <span className="text-xs text-muted-foreground">名称：</span>
                      <span>{mfg.entrustedParty.name || '—'}</span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">地址：</span>
                      <span>{mfg.entrustedParty.address || '—'}</span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">电话：</span>
                      <span>{mfg.entrustedParty.phone || '—'}</span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">许可证：</span>
                      <span>{mfg.entrustedParty.license || '—'}</span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">产地：</span>
                      <span>{mfg.entrustedParty.origin || '—'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 手动输入区域 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">手动输入信息</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-6">
            {/* 委托方手动输入 */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                委托方
              </h3>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="manual-delegator-name">名称</Label>
                  <Input
                    id="manual-delegator-name"
                    value={manualDelegator.name}
                    onChange={(e) =>
                      setManualDelegator((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder="请输入委托方名称"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="manual-delegator-address">地址</Label>
                  <Input
                    id="manual-delegator-address"
                    value={manualDelegator.address}
                    onChange={(e) =>
                      setManualDelegator((prev) => ({ ...prev, address: e.target.value }))
                    }
                    placeholder="请输入委托方地址"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="manual-delegator-phone">电话</Label>
                  <Input
                    id="manual-delegator-phone"
                    value={manualDelegator.phone}
                    onChange={(e) =>
                      setManualDelegator((prev) => ({ ...prev, phone: e.target.value }))
                    }
                    placeholder="请输入委托方电话"
                  />
                </div>
              </div>
            </div>

            {/* 被委托方手动输入 */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                被委托方
              </h3>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="manual-entrusted-name">名称</Label>
                  <Input
                    id="manual-entrusted-name"
                    value={manualEntrusted.name}
                    onChange={(e) =>
                      setManualEntrusted((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder="请输入被委托方名称"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="manual-entrusted-address">地址</Label>
                  <Input
                    id="manual-entrusted-address"
                    value={manualEntrusted.address}
                    onChange={(e) =>
                      setManualEntrusted((prev) => ({ ...prev, address: e.target.value }))
                    }
                    placeholder="请输入被委托方地址"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="manual-entrusted-phone">电话</Label>
                  <Input
                    id="manual-entrusted-phone"
                    value={manualEntrusted.phone}
                    onChange={(e) =>
                      setManualEntrusted((prev) => ({ ...prev, phone: e.target.value }))
                    }
                    placeholder="请输入被委托方电话"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="manual-entrusted-license">许可证编号</Label>
                  <Input
                    id="manual-entrusted-license"
                    value={manualEntrusted.license}
                    onChange={(e) =>
                      setManualEntrusted((prev) => ({ ...prev, license: e.target.value }))
                    }
                    placeholder="请输入许可证编号"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="manual-entrusted-origin">产地</Label>
                  <Input
                    id="manual-entrusted-origin"
                    value={manualEntrusted.origin}
                    onChange={(e) =>
                      setManualEntrusted((prev) => ({ ...prev, origin: e.target.value }))
                    }
                    placeholder="请输入产地"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 对比按钮 */}
          <div className="flex justify-center mt-6">
            <Button onClick={handleCompare} size="lg">
              对比
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 对比结果 */}
      {hasCompared && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">对比结果</CardTitle>
              {mismatchCount > 0 ? (
                <Badge variant="destructive">
                  <XCircle className="size-3 mr-1" />
                  {mismatchCount} 项不一致
                </Badge>
              ) : (
                <Badge className="bg-success text-success-foreground">
                  <CheckCircle2 className="size-3 mr-1" />
                  全部一致
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {compareResults.map((result, index) => (
                <div
                  key={index}
                  className={`p-4 rounded-lg border ${
                    result.match
                      ? 'bg-success-100 border-success/20'
                      : 'bg-destructive-100 border-destructive/20'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    {result.match ? (
                      <CheckCircle2 className="size-4 text-success" />
                    ) : (
                      <XCircle className="size-4 text-destructive" />
                    )}
                    <span className="text-sm font-medium">{result.field}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-xs text-muted-foreground">原始提取：</span>
                      <span className={result.match ? '' : 'text-muted-foreground'}>
                        {result.original || '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">手动输入：</span>
                      <span className={result.match ? '' : 'text-destructive font-medium'}>
                        {result.manual || '—'}
                      </span>
                    </div>
                  </div>
                  {!result.match && (
                    <div className="flex items-center gap-4 mt-3 pt-3 border-t border-destructive/20">
                      <span className="text-xs text-muted-foreground">选择最终值：</span>
                      <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                        <input
                          type="radio"
                          name={`choice-${index}`}
                          checked={result.choice === 'original'}
                          onChange={() => handleChoiceChange(index, 'original')}
                          className="accent-primary"
                        />
                        使用原始
                      </label>
                      <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                        <input
                          type="radio"
                          name={`choice-${index}`}
                          checked={result.choice === 'manual'}
                          onChange={() => handleChoiceChange(index, 'manual')}
                          className="accent-primary"
                        />
                        使用更新
                      </label>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* 确认按钮 */}
            <div className="flex justify-center mt-6">
              <Button onClick={handleConfirm} size="lg">
                <CheckCircle2 className="size-4 mr-2" />
                确认信息
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 最终确认信息 */}
      {finalInfo && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">最终确认信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              {/* 委托方 */}
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  委托方
                </h3>
                <div className="text-sm space-y-1">
                  <div>
                    <span className="text-xs text-muted-foreground">名称：</span>
                    <span>{finalInfo.delegator.name || '—'}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">地址：</span>
                    <span>{finalInfo.delegator.address || '—'}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">电话：</span>
                    <span>{finalInfo.delegator.phone || '—'}</span>
                  </div>
                </div>
              </div>

              {/* 被委托方 */}
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  被委托方
                </h3>
                <div className="text-sm space-y-1">
                  <div>
                    <span className="text-xs text-muted-foreground">名称：</span>
                    <span>{finalInfo.entrustedParty.name || '—'}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">地址：</span>
                    <span>{finalInfo.entrustedParty.address || '—'}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">电话：</span>
                    <span>{finalInfo.entrustedParty.phone || '—'}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">许可证：</span>
                    <span>{finalInfo.entrustedParty.license || '—'}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">产地：</span>
                    <span>{finalInfo.entrustedParty.origin || '—'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 导出Word */}
            <div className="border-t pt-4">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <Label htmlFor="word-filename" className="text-sm">文件名</Label>
                  <Input
                    id="word-filename"
                    value={wordFilename}
                    onChange={(e) => setWordFilename(e.target.value)}
                    placeholder="请输入文件名"
                    className="mt-1"
                  />
                </div>
                <Button onClick={exportFinalInfoToWord} className="mt-5">
                  <FileText className="size-4 mr-2" />
                  下载Word
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 历史记录 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <History className="size-5 text-muted-foreground" />
            <CardTitle className="text-lg">历史记录</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {loadingHistory ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : historyRecords.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              暂无历史记录
            </p>
          ) : (
            <div className="space-y-2">
              {historyRecords.map((record) => (
                <div
                  key={record.id}
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText className="size-5 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium truncate">{record.fileName}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(record.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleViewHistory(record)}
                    >
                      <Eye className="size-4 mr-1" />
                      查看
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteHistory(record.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 查看历史记录详情对话框 */}
      <Dialog open={viewRecord !== null || viewLoading} onOpenChange={(open) => { if (!open) setViewRecord(null); }}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>历史记录详情</DialogTitle>
            <DialogDescription>
              {viewRecord ? `${viewRecord.fileName} - ${new Date(viewRecord.createdAt).toLocaleString()}` : '加载中...'}
            </DialogDescription>
          </DialogHeader>

          {viewLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-8 animate-spin text-primary" />
            </div>
          ) : viewRecord ? (
            <div className="space-y-6">
              {/* 食品信息 */}
              {(viewRecord.foodList?.length || viewRecord.foodInfo) && (
                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                    食品信息
                  </h3>
                  <div className="space-y-4">
                    {(viewRecord.foodList?.length
                      ? viewRecord.foodList
                      : [{ ...viewRecord.foodInfo!, title: '食品1' }]
                    ).map((food, idx) => (
                      <div key={idx}>
                        <h4 className="text-sm font-medium mb-2">
                          {food.title || `食品${idx + 1}`}
                        </h4>
                        <div className="grid grid-cols-3 gap-4 text-sm">
                          <div>
                            <span className="text-xs text-muted-foreground block">产品名称</span>
                            <span>{food.name || '—'}</span>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground block">产品类型</span>
                            <span>{food.type || '—'}</span>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground block">净含量</span>
                            <span>{food.netContent || '—'}</span>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground block">配料</span>
                            <span className="line-clamp-2">{food.ingredients || '—'}</span>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground block">保质期</span>
                            <span>{food.shelfLife || '—'}</span>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground block">储存条件</span>
                            <span>{food.storageCondition || '—'}</span>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground block">生产日期</span>
                            <span>{food.productionDate || '—'}</span>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground block">产品标准号</span>
                            <span>{food.standardCode || '—'}</span>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground block">营养成分</span>
                            <span className="line-clamp-2">{food.nutrition || '—'}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 厂商信息 */}
              {(() => {
                const mList: ManufacturerInfo[] = viewRecord.manufacturerList?.length
                  ? viewRecord.manufacturerList
                  : viewRecord.manufacturerInfo
                    ? [viewRecord.manufacturerInfo]
                    : [];
                return mList.map((mfg, idx) => (
                  <div key={idx} className={idx > 0 ? 'border-t pt-4 mt-4' : ''}>
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                      {mList.length > 1 ? `厂商${idx + 1}` : '厂商信息'}
                    </h3>
                    <div className="grid grid-cols-2 gap-6">
                      {/* 原料生产商 */}
                      <div className="space-y-2">
                        <h4 className="text-xs font-medium text-red-600 uppercase">原料生产商</h4>
                        <div className="text-sm space-y-1">
                          <div>
                            <span className="text-xs text-muted-foreground">名称：</span>
                            <span>{mfg.rawMaterialSupplier.name || '—'}</span>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground">地址：</span>
                            <span>{mfg.rawMaterialSupplier.address || '—'}</span>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground">电话：</span>
                            <span>{mfg.rawMaterialSupplier.phone || '—'}</span>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground">许可证：</span>
                            <span>{mfg.rawMaterialSupplier.license || '—'}</span>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground">产地：</span>
                            <span>{mfg.rawMaterialSupplier.origin || '—'}</span>
                          </div>
                        </div>
                      </div>

                      {/* 委托方 */}
                      <div className="space-y-2">
                        <h4 className="text-xs font-medium text-blue-600 uppercase">委托方</h4>
                        <div className="text-sm space-y-1">
                          <div>
                            <span className="text-xs text-muted-foreground">名称：</span>
                            <span>{mfg.delegator.name || '—'}</span>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground">地址：</span>
                            <span>{mfg.delegator.address || '—'}</span>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground">电话：</span>
                            <span>{mfg.delegator.phone || '—'}</span>
                          </div>
                        </div>
                      </div>

                      {/* 被委托方 */}
                      <div className="space-y-2 col-span-2">
                        <h4 className="text-xs font-medium text-yellow-600 uppercase">被委托方</h4>
                        <div className="text-sm space-y-1">
                          <div>
                            <span className="text-xs text-muted-foreground">名称：</span>
                            <span>{mfg.entrustedParty.name || '—'}</span>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground">地址：</span>
                            <span>{mfg.entrustedParty.address || '—'}</span>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground">电话：</span>
                            <span>{mfg.entrustedParty.phone || '—'}</span>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground">许可证：</span>
                            <span>{mfg.entrustedParty.license || '—'}</span>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground">产地：</span>
                            <span>{mfg.entrustedParty.origin || '—'}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ));
              })()}

              {!viewRecord.foodList?.length && !viewRecord.foodInfo && manufacturerList.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  该记录暂无详细信息
                </p>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default VerifyPage;
