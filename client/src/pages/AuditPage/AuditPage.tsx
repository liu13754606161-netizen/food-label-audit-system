import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Loader2, Plus, RefreshCw, Trash2, Upload, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { compareImageWithDocument, extractManufacturerFromImage, saveGenerate } from '@/api';
import { toast } from 'sonner';
import type { FoodInfoItem, LabelCompareField, ManufacturerInfo } from '@shared/api.interface';

type RunStatus = 'idle' | 'running' | 'done' | 'error';

interface FoodGroup {
  id: string;
  basicImage: File | null;
  nutritionImage: File | null;
  manufacturerImage: File | null;
  document: File | null;
  fields: LabelCompareField[];
  imageFood?: FoodInfoItem;
  documentFood?: FoodInfoItem;
  manufacturerInfo: ManufacturerInfo;
  manufacturerRawText?: string;
  status: RunStatus;
  error?: string;
}

const emptyFoodInfo: FoodInfoItem = {
  name: '',
  type: '',
  ingredients: '',
  nutrition: '',
  netContent: '',
  productionDate: '',
  shelfLife: '',
  storageCondition: '',
  standardCode: '',
  allergens: [],
  tips: '',
  license: '',
  title: '',
};

const emptyManufacturerInfo: ManufacturerInfo = {
  rawMaterialSupplier: { name: '', address: '', phone: '', license: '', origin: '' },
  delegator: { name: '', address: '', phone: '' },
  entrustedParty: { name: '', address: '', phone: '', license: '', origin: '' },
};

const newId = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;

const createFoodGroup = (): FoodGroup => ({
  id: newId(),
  basicImage: null,
  nutritionImage: null,
  manufacturerImage: null,
  document: null,
  fields: [],
  manufacturerInfo: emptyManufacturerInfo,
  status: 'idle',
});

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

const escapeHtml = (value: unknown) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

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

const uniqueManufacturerList = (list: ManufacturerInfo[]) => {
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

function parseNutritionRows(value?: string): NutritionRow[] {
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
}

function renderNutritionValue(value?: string) {
  const text = String(value || '').trim();
  const rows = parseNutritionRows(text);
  if (rows.length < 3) return escapeHtml(text);
  const hasNrv = rows.some((row) => row.nrv);
  return `
    <table class="nutrition-table">
      <tr><th>项目</th><th>每100克</th>${hasNrv ? '<th>NRV%</th>' : ''}</tr>
      ${rows.map((row) => `
        <tr>
          <td>${escapeHtml(row.item)}</td>
          <td>${escapeHtml(row.amount)}</td>
          ${hasNrv ? `<td>${escapeHtml(row.nrv)}</td>` : ''}
        </tr>
      `).join('')}
    </table>
  `;
}

function buildRawTextForWord(foodList: FoodInfoItem[], manufacturerList: ManufacturerInfo[]) {
  const foodSections = foodList.map((food, index) => [
    `========== 食品${index + 1}：${food.title || food.name || `食品${index + 1}`} ==========`,
    `食品名称/产品名称：${food.name || ''}`,
    `产品类型：${food.type || ''}`,
    `配料表：${food.ingredients || ''}`,
    `营养成分表：${food.nutrition || ''}`,
    `净含量：${food.netContent || ''}`,
    `保质期：${food.shelfLife || ''}`,
    `贮存条件：${food.storageCondition || ''}`,
    `产品标准号：${food.standardCode || ''}`,
    `生产许可证编号：${food.license || ''}`,
    `过敏原：${food.allergens?.join('、') || ''}`,
    `温馨提示：${food.tips || ''}`,
  ].filter((line) => !line.endsWith('：')).join('\n'));

  const manufacturerSections = manufacturerList.map((info, index) => [
    `========== 厂商${index + 1} ==========`,
    `原料生产商名称：${info.rawMaterialSupplier?.name || ''}`,
    `原料生产商地址：${info.rawMaterialSupplier?.address || ''}`,
    `原料生产商电话：${info.rawMaterialSupplier?.phone || ''}`,
    `原料生产商许可证：${info.rawMaterialSupplier?.license || ''}`,
    `原料生产商产地：${info.rawMaterialSupplier?.origin || ''}`,
    `委托方名称：${info.delegator?.name || ''}`,
    `委托方地址：${info.delegator?.address || ''}`,
    `委托方电话：${info.delegator?.phone || ''}`,
    `被委托方名称：${info.entrustedParty?.name || ''}`,
    `被委托方地址：${info.entrustedParty?.address || ''}`,
    `被委托方电话：${info.entrustedParty?.phone || ''}`,
    `被委托方许可证：${info.entrustedParty?.license || ''}`,
    `被委托方产地：${info.entrustedParty?.origin || ''}`,
  ].filter((line) => !line.endsWith('：')).join('\n'));

  return [...foodSections, ...manufacturerSections].filter(Boolean).join('\n\n');
}

const foodPropMap: Record<string, keyof FoodInfoItem> = {
  name: 'name',
  type: 'type',
  ingredients: 'ingredients',
  netContent: 'netContent',
  shelfLife: 'shelfLife',
  storageCondition: 'storageCondition',
  standardCode: 'standardCode',
  license: 'license',
  allergens: 'allergens',
  tips: 'tips',
  nutrition: 'nutrition',
};

function foodFromFields(group: FoodGroup, index: number): FoodInfoItem {
  const food: FoodInfoItem = {
    ...emptyFoodInfo,
    ...(group.imageFood || {}),
    title: group.imageFood?.title || group.imageFood?.name || `食品${index + 1}`,
  };

  group.fields.forEach((field) => {
    const propName = field.key.split('.').pop() || '';
    const prop = foodPropMap[propName];
    if (!prop) return;
    if (prop === 'allergens') {
      food.allergens = field.finalValue ? field.finalValue.split(/[、,，]/).map((item) => item.trim()).filter(Boolean) : [];
      return;
    }
    (food as unknown as Record<string, string>)[prop] = field.finalValue;
  });

  if (!food.title) food.title = food.name || `食品${index + 1}`;
  return food;
}

function renderFoodSection(food: FoodInfoItem, index: number) {
  const rows = [
    ['食品名称/产品名称', food.name],
    ['产品类型', food.type],
    ['配料表', food.ingredients],
    ['营养成分表', food.nutrition],
    ['净含量', food.netContent],
    ['保质期', food.shelfLife],
    ['贮存条件', food.storageCondition],
    ['产品标准号', food.standardCode],
    ['生产许可证编号', food.license],
    ['过敏原', food.allergens?.join('、')],
    ['温馨提示', food.tips],
  ].filter(([, value]) => hasText(value));
  return `
    <h2>========== 食品${index + 1}：${escapeHtml(food.title || food.name || `食品${index + 1}`)} ==========</h2>
    <table>
      ${rows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${label === '营养成分表' ? renderNutritionValue(value) : escapeHtml(value)}</td></tr>`).join('')}
    </table>
  `;
}

function renderManufacturerSection(info: ManufacturerInfo, index: number) {
  const rows = [
    ['原料生产商名称', info.rawMaterialSupplier.name],
    ['原料生产商地址', info.rawMaterialSupplier.address],
    ['原料生产商电话', info.rawMaterialSupplier.phone],
    ['原料生产商许可证', info.rawMaterialSupplier.license],
    ['原料生产商产地', info.rawMaterialSupplier.origin],
    ['委托方名称', info.delegator.name],
    ['委托方地址', info.delegator.address],
    ['委托方电话', info.delegator.phone],
    ['被委托方名称', info.entrustedParty.name],
    ['被委托方地址', info.entrustedParty.address],
    ['被委托方电话', info.entrustedParty.phone],
    ['被委托方许可证', info.entrustedParty.license],
    ['被委托方产地', info.entrustedParty.origin],
  ].filter(([, value]) => hasText(value));
  if (!rows.length) return '';
  return `
    <h2>========== 厂商${index + 1} ==========</h2>
    <table>
      ${rows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join('')}
    </table>
  `;
}

const AuditPage: React.FC = () => {
  const navigate = useNavigate();
  const [foodGroups, setFoodGroups] = useState<FoodGroup[]>([createFoodGroup()]);
  const [isRunning, setIsRunning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [progressValue, setProgressValue] = useState(0);

  const summary = useMemo(() => {
    const fields = foodGroups.flatMap((group) => group.fields);
    return {
      total: fields.length,
      matches: fields.filter((field) => field.match).length,
      mismatches: fields.filter((field) => !field.match).length,
      manufacturers: foodGroups.filter((group) => hasManufacturerContent(group.manufacturerInfo)).length,
    };
  }, [foodGroups]);
  const allGroupsDone = foodGroups.every((group) => group.status === 'done');
  const runButtonDisabled = isRunning || allGroupsDone;

  const setFoodFile = (id: string, key: 'basicImage' | 'nutritionImage' | 'document', file: File | null) => {
    setFoodGroups((prev) =>
      prev.map((group) =>
        group.id === id
          ? { ...group, [key]: file, fields: [], status: 'idle', error: undefined }
          : group,
      ),
    );
  };

  const setManufacturerFile = (id: string, file: File | null) => {
    setFoodGroups((prev) =>
      prev.map((group) =>
        group.id === id
          ? {
              ...group,
              manufacturerImage: file,
              manufacturerInfo: emptyManufacturerInfo,
              manufacturerRawText: '',
              status: 'idle',
              error: undefined,
            }
          : group,
      ),
    );
  };

  const updateFieldSource = (groupId: string, key: string, selectedSource: 'image' | 'document') => {
    setFoodGroups((prev) =>
      prev.map((group) =>
        group.id === groupId
          ? {
              ...group,
              fields: group.fields.map((field) =>
                field.key === key
                  ? {
                      ...field,
                      selectedSource,
                      finalValue: selectedSource === 'image' ? field.imageValue : field.documentValue,
                    }
                  : field,
              ),
            }
          : group,
      ),
    );
  };

  const updateFieldValue = (groupId: string, key: string, finalValue: string) => {
    setFoodGroups((prev) =>
      prev.map((group) =>
        group.id === groupId
          ? { ...group, fields: group.fields.map((field) => (field.key === key ? { ...field, finalValue } : field)) }
          : group,
      ),
    );
  };

  const updateManufacturer = (
    groupId: string,
    section: keyof ManufacturerInfo,
    field: string,
    value: string,
  ) => {
    setFoodGroups((prev) =>
      prev.map((group) =>
        group.id === groupId
          ? {
              ...group,
              manufacturerInfo: {
                ...group.manufacturerInfo,
                [section]: {
                  ...group.manufacturerInfo[section],
                  [field]: value,
                },
              },
            }
          : group,
      ),
    );
  };

  const addFoodGroup = () => setFoodGroups((prev) => [...prev, createFoodGroup()]);

  const removeFoodGroup = (id: string) => {
    setFoodGroups((prev) => (prev.length > 1 ? prev.filter((group) => group.id !== id) : prev));
  };

  const resetAll = () => {
    setFoodGroups([createFoodGroup()]);
    setProgressText('');
    setProgressValue(0);
  };

  const runAll = async () => {
    const invalidFood = foodGroups.find(
      (group) => !group.basicImage || !group.nutritionImage || !group.manufacturerImage || !group.document,
    );
    if (invalidFood) {
      toast.error('每个食品都需要上传基础信息截图、配料/营养截图、厂商截图和核对文件');
      return;
    }

    setIsRunning(true);
    setProgressValue(2);
    try {
      const totalSteps = foodGroups.length * 2;
      let completedSteps = 0;
      for (let index = 0; index < foodGroups.length; index += 1) {
        const group = foodGroups[index];
        setProgressText(`正在核对食品 ${index + 1}/${foodGroups.length}`);
        setFoodGroups((prev) => prev.map((item) => (item.id === group.id ? { ...item, status: 'running', error: undefined } : item)));
        try {
          setProgressText(`正在核对食品 ${index + 1}/${foodGroups.length}`);
          const result = await compareImageWithDocument({
            foodImage: group.basicImage as File,
            nutritionImage: group.nutritionImage as File,
            document: group.document as File,
          });
          completedSteps += 1;
          setProgressValue(Math.max(5, Math.round((completedSteps / totalSteps) * 100)));
          setProgressText(`正在提取食品 ${index + 1}/${foodGroups.length} 的厂商信息`);
          const manufacturerResult = await extractManufacturerFromImage(group.manufacturerImage as File);
          completedSteps += 1;
          setProgressValue(Math.max(5, Math.round((completedSteps / totalSteps) * 100)));
          setFoodGroups((prev) =>
            prev.map((item) =>
              item.id === group.id
                ? {
                    ...item,
                    status: 'done',
                    fields: result.fields,
                    imageFood: (result.imageInfo.foodList?.[0] || result.imageInfo.foodInfo) as FoodInfoItem,
                    documentFood: (result.documentInfo.foodList?.[0] || result.documentInfo.foodInfo) as FoodInfoItem,
                    manufacturerInfo: manufacturerResult.manufacturerInfo,
                    manufacturerRawText: manufacturerResult.rawText || '',
                  }
                : item,
            ),
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : '核对失败';
          setFoodGroups((prev) => prev.map((item) => (item.id === group.id ? { ...item, status: 'error', error: message } : item)));
          throw new Error(`食品${index + 1}：${message}`);
        }
      }

      setProgressText('核对和提取完成');
      setProgressValue(100);
      toast.success('核对和厂商提取完成');
    } catch (error) {
      const message = error instanceof Error ? error.message : '处理失败';
      toast.error(message);
      setProgressText(message);
      setProgressValue((value) => (value > 0 ? value : 5));
    } finally {
      setIsRunning(false);
    }
  };

  const goToGenerate = async () => {
    const unfinishedFood = foodGroups.find((group) => !group.fields.length);
    if (unfinishedFood) {
      toast.error('请先完成所有食品核对');
      return;
    }

    const foodList = foodGroups.map(foodFromFields);
    const manufacturerList = uniqueManufacturerList(foodGroups.map((group) => group.manufacturerInfo));
    const rawMaterialSupplierList = manufacturerList.map((item) => item.rawMaterialSupplier).filter((item) => hasText(item.name));
    const delegatorList = manufacturerList.map((item) => item.delegator).filter((item) => hasText(item.name));
    const entrustedPartyList = manufacturerList.map((item) => item.entrustedParty).filter((item) => hasText(item.name));
    const primaryManufacturer = manufacturerList[0] || emptyManufacturerInfo;

    setIsSaving(true);
    try {
      const fallbackRecordId = `local_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const draftState = {
        recordId: fallbackRecordId,
        fileName: '食品标签核对结果',
        foodInfo: foodList[0],
        isMultiFood: foodList.length > 1,
        foodList,
        currentFoodIndex: 0,
        manufacturerInfo: primaryManufacturer,
        manufacturerList,
        currentManufacturerIndex: 0,
        rawMaterialSupplierList,
        currentRawMaterialSupplierIndex: 0,
        delegatorList,
        currentDelegatorIndex: 0,
        entrustedPartyList,
        currentEntrustedPartyIndex: 0,
      };
      localStorage.setItem('generate_draft_state', JSON.stringify(draftState));
      localStorage.setItem('generate_draft_handoff', '1');

      let recordId = fallbackRecordId;
      try {
        const saveResp = await saveGenerate({
        recordId: '',
        manufacturerInfo: primaryManufacturer,
        foodInfo: foodList[0],
        isMultiFood: foodList.length > 1,
        foodList,
        manufacturerList,
        rawMaterialSupplierList,
        delegatorList,
        entrustedPartyList,
        rawText: buildRawTextForWord(foodList, manufacturerList),
        });
        recordId = saveResp.recordId || fallbackRecordId;
        localStorage.setItem('generate_draft_state', JSON.stringify({ ...draftState, recordId }));
        localStorage.setItem('generate_draft_handoff', '1');
      } catch (error) {
        console.warn('保存到本地服务失败，已使用浏览器缓存继续进入第三界面', error);
        toast.warning('本地服务保存失败，已先保存到浏览器并继续进入第三界面');
      }

      toast.success('已进入第三界面');
      window.setTimeout(() => navigate('/generate'), 300);
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存失败';
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">食品标签核对与厂商提取</h1>
          <p className="text-sm text-muted-foreground mt-1">
            每个食品上传基础信息、配料/营养、厂商信息和白签文件；食品信息参与白签核对，厂商信息只从厂商截图提取
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">食品核对</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {foodGroups.map((group, index) => (
            <div key={group.id} className="rounded-lg border p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">食品 {index + 1}</p>
                  <p className="text-xs text-muted-foreground">基础信息和配料/营养会一起和白签核对，厂商截图只做直接提取</p>
                </div>
                {foodGroups.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => removeFoodGroup(group.id)}>
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <FileInput
                  id={`${group.id}-basicImage`}
                  label="食品基础信息截图"
                  file={group.basicImage}
                  accept="image/*"
                  onChange={(file) => setFoodFile(group.id, 'basicImage', file)}
                />
                <FileInput
                  id={`${group.id}-nutritionImage`}
                  label="配料/营养成分表截图"
                  file={group.nutritionImage}
                  accept="image/*"
                  onChange={(file) => setFoodFile(group.id, 'nutritionImage', file)}
                />
                <FileInput
                  id={`${group.id}-manufacturerImage`}
                  label="厂商信息截图"
                  file={group.manufacturerImage}
                  accept="image/*"
                  onChange={(file) => setManufacturerFile(group.id, file)}
                />
                <FileInput
                  id={`${group.id}-document`}
                  label="核对文件（白签）"
                  file={group.document}
                  accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(file) => setFoodFile(group.id, 'document', file)}
                />
              </div>
              {group.status === 'error' && (
                <p className="text-sm text-destructive">{group.error}</p>
              )}
              {group.status === 'done' && !hasManufacturerContent(group.manufacturerInfo) && (
                <p className="text-sm text-muted-foreground">厂商截图没有识别到明确厂商信息，已按空处理，不会从食品图里补造。</p>
              )}
              {hasManufacturerContent(group.manufacturerInfo) && (
                <ManufacturerEditor
                  group={group}
                  onChange={updateManufacturer}
                />
              )}
              {group.fields.length > 0 && (
                <FoodResult
                  group={group}
                  groupIndex={index}
                  onSourceChange={updateFieldSource}
                  onValueChange={updateFieldValue}
                />
              )}
            </div>
          ))}

          <Button variant="outline" onClick={addFoodGroup}>
            <Plus className="size-4 mr-2" />
            添加食品
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <SummaryCard label="核对项" value={summary.total} />
            <SummaryCard label="一致" value={summary.matches} tone="success" />
            <SummaryCard label="不一致/缺失" value={summary.mismatches} tone="danger" />
            <SummaryCard label="已提取厂商" value={summary.manufacturers} />
          </div>
          {progressText && <p className="text-sm text-muted-foreground">{progressText}</p>}
          {(isRunning || progressValue > 0) && (
            <div className="space-y-1">
              <Progress value={progressValue} />
              <p className="text-xs text-muted-foreground">{progressValue}%</p>
            </div>
          )}
          <div className="flex flex-col md:flex-row gap-3">
            <Button
              onClick={runAll}
              disabled={runButtonDisabled}
              variant={allGroupsDone ? 'outline' : 'default'}
              className={allGroupsDone ? 'text-muted-foreground border-muted-foreground/30 bg-muted cursor-not-allowed' : ''}
            >
              {isRunning ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : allGroupsDone ? (
                <CheckCircle2 className="size-4 mr-2" />
              ) : (
                <RefreshCw className="size-4 mr-2" />
              )}
              {isRunning ? '正在核对...' : allGroupsDone ? '已完成核对' : '开始核对并提取'}
            </Button>
            <Button onClick={goToGenerate} disabled={isRunning || isSaving || summary.total === 0}>
              {isSaving ? <Loader2 className="size-4 mr-2 animate-spin" /> : <ArrowRight className="size-4 mr-2" />}
              进入第三界面
            </Button>
            <Button variant="outline" onClick={resetAll} disabled={isRunning || isSaving}>
              清空
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

function FileInput(props: {
  id: string;
  label: string;
  file: File | null;
  accept: string;
  onChange: (file: File | null) => void;
}) {
  const inputId = `file-input-${props.id}`;
  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="text-sm font-medium">{props.label}</label>
      <input
        id={inputId}
        type="file"
        accept={props.accept}
        className="sr-only"
        onChange={(event) => {
          props.onChange(event.target.files?.[0] || null);
          event.currentTarget.value = '';
        }}
      />
      <label
        htmlFor={inputId}
        className={`flex h-11 cursor-pointer items-center justify-center rounded-md border px-3 text-sm transition-colors ${
          props.file
            ? 'border-slate-300 bg-slate-100 text-slate-500'
            : 'border-input bg-background hover:bg-accent hover:text-accent-foreground'
        }`}
      >
        <Upload className="mr-2 size-4" />
        {props.file ? '重新上传' : '上传'}
      </label>
      {props.file && <p className="text-xs text-muted-foreground truncate">{props.file.name}</p>}
    </div>
  );
}

function SummaryCard(props: { label: string; value: number; tone?: 'success' | 'danger' }) {
  const color = props.tone === 'success' ? 'text-success' : props.tone === 'danger' ? 'text-destructive' : 'text-primary';
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{props.label}</p>
      <p className={`text-2xl font-semibold ${color}`}>{props.value}</p>
    </div>
  );
}

function FoodResult(props: {
  group: FoodGroup;
  groupIndex: number;
  onSourceChange: (groupId: string, key: string, source: 'image' | 'document') => void;
  onValueChange: (groupId: string, key: string, value: string) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">食品 {props.groupIndex + 1} 核对结果</p>
      {props.group.fields.map((field) => (
        <div
          key={field.key}
          className={`rounded-lg border p-4 ${
            field.match ? 'bg-success-100 border-success/20' : 'bg-destructive-100 border-destructive/20'
          }`}
        >
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              {field.match ? (
                <CheckCircle2 className="size-4 text-success" />
              ) : (
                <XCircle className="size-4 text-destructive" />
              )}
              <span className="text-sm font-semibold">{field.label}</span>
              <span className="text-xs text-muted-foreground">{field.section}</span>
            </div>
            <span className="text-xs text-muted-foreground">{field.match ? '一致' : '需要确认'}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="rounded-md border bg-card p-3 cursor-pointer">
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="radio"
                  name={`source-${props.group.id}-${field.key}`}
                  checked={field.selectedSource === 'image'}
                  onChange={() => props.onSourceChange(props.group.id, field.key, 'image')}
                />
                <span className="text-sm font-medium">使用图片识别结果</span>
              </div>
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">{field.imageValue || '—'}</p>
            </label>
            <label className="rounded-md border bg-card p-3 cursor-pointer">
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="radio"
                  name={`source-${props.group.id}-${field.key}`}
                  checked={field.selectedSource === 'document'}
                  onChange={() => props.onSourceChange(props.group.id, field.key, 'document')}
                />
                <span className="text-sm font-medium">使用文件提取结果</span>
              </div>
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">{field.documentValue || '—'}</p>
            </label>
          </div>
          <div className="mt-3 space-y-1.5">
            <label className="text-xs text-muted-foreground">最终保存内容</label>
            <Textarea
              value={field.finalValue}
              onChange={(event) => props.onValueChange(props.group.id, field.key, event.target.value)}
              rows={field.finalValue.length > 80 || field.key.includes('nutrition') || field.key.includes('ingredients') ? 3 : 1}
              className="text-sm"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function ManufacturerEditor(props: {
  group: FoodGroup;
  onChange: (groupId: string, section: keyof ManufacturerInfo, field: string, value: string) => void;
}) {
  const { group } = props;
  const input = (section: keyof ManufacturerInfo, field: string, label: string, value: string | undefined) => (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <Input
        value={value || ''}
        onChange={(event) => props.onChange(group.id, section, field, event.target.value)}
      />
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="rounded-md border p-3 space-y-2">
        <p className="text-sm font-semibold">原料生产商/生产商</p>
        {input('rawMaterialSupplier', 'name', '名称', group.manufacturerInfo.rawMaterialSupplier.name)}
        {input('rawMaterialSupplier', 'address', '地址', group.manufacturerInfo.rawMaterialSupplier.address)}
        {input('rawMaterialSupplier', 'license', '许可证编号', group.manufacturerInfo.rawMaterialSupplier.license)}
        {input('rawMaterialSupplier', 'origin', '产地', group.manufacturerInfo.rawMaterialSupplier.origin)}
        {input('rawMaterialSupplier', 'phone', '电话', group.manufacturerInfo.rawMaterialSupplier.phone)}
      </div>
      <div className="rounded-md border p-3 space-y-2">
        <p className="text-sm font-semibold">委托方/经销商</p>
        {input('delegator', 'name', '名称', group.manufacturerInfo.delegator.name)}
        {input('delegator', 'address', '地址', group.manufacturerInfo.delegator.address)}
        {input('delegator', 'phone', '电话', group.manufacturerInfo.delegator.phone)}
      </div>
      <div className="rounded-md border p-3 space-y-2">
        <p className="text-sm font-semibold">被委托方/分装厂</p>
        {input('entrustedParty', 'name', '名称', group.manufacturerInfo.entrustedParty.name)}
        {input('entrustedParty', 'address', '地址', group.manufacturerInfo.entrustedParty.address)}
        {input('entrustedParty', 'license', '许可证编号', group.manufacturerInfo.entrustedParty.license)}
        {input('entrustedParty', 'origin', '产地', group.manufacturerInfo.entrustedParty.origin)}
        {input('entrustedParty', 'phone', '电话', group.manufacturerInfo.entrustedParty.phone)}
      </div>
    </div>
  );
}

export default AuditPage;
