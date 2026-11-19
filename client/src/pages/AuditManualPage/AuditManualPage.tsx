import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  Loader2,
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  ScrollText,
  Building2,
  Package,
  Settings,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { saveAudit, verifyLabel, exportAuditReport } from '@/api';
import { toast } from 'sonner';
import type {
  ManufacturerInfo,
  FoodInfo,
  AuditResult,
  NonComplianceItem,
} from '@shared/api.interface';

type SectionStatus = 'pending' | 'pass' | 'fail';

interface FormState {
  manufacturerInfo: ManufacturerInfo;
  foodInfo: FoodInfo;
}

interface SectionResult {
  name: string;
  status: SectionStatus;
  items: NonComplianceItem[];
}

const initialManufacturerInfo: ManufacturerInfo = {
  rawMaterialSupplier: {
    name: '',
    address: '',
    phone: '',
    license: '',
    origin: '',
  },
  delegator: {
    name: '',
    address: '',
    phone: '',
  },
  entrustedParty: {
    name: '',
    address: '',
    phone: '',
    license: '',
    origin: '',
  },
};

const initialFoodInfo: FoodInfo = {
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
};

const AuditManualPage: React.FC = () => {
  const navigate = useNavigate();
  const [recordId, setRecordId] = useState<string>('');
  const [formState, setFormState] = useState<FormState>({
    manufacturerInfo: initialManufacturerInfo,
    foodInfo: initialFoodInfo,
  });
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [selectedStandards, setSelectedStandards] = useState<string[]>([
    'mars',
    'gb7718',
  ]);
  const [allergensInput, setAllergensInput] = useState('');
  const [tipsInput, setTipsInput] = useState('');

  // Collapsible states
  const [formOpen, setFormOpen] = useState(true);
  const [auditOpen, setAuditOpen] = useState(false);

  const handleInputChange = (
    section: keyof FormState,
    field: string,
    value: string
  ) => {
    setFormState((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: value,
      },
    }));
  };

  const handleNestedInputChange = (
    section: 'manufacturerInfo',
    subsection: keyof ManufacturerInfo,
    field: string,
    value: string
  ) => {
    setFormState((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [subsection]: {
          ...prev[section][subsection],
          [field]: value,
        },
      },
    }));
  };

  const handleStandardToggle = (standard: string) => {
    setSelectedStandards((prev) =>
      prev.includes(standard)
        ? prev.filter((s) => s !== standard)
        : [...prev, standard]
    );
  };

  const handleAllergensChange = (value: string) => {
    setAllergensInput(value);
    const allergens = value
      .split(/[,，、]/)
      .map((s) => s.trim())
      .filter(Boolean);
    setFormState((prev) => ({
      ...prev,
      foodInfo: {
        ...prev.foodInfo,
        allergens,
      },
    }));
  };

  const handleTipsChange = (value: string) => {
    setTipsInput(value);
    setFormState((prev) => ({
      ...prev,
      foodInfo: {
        ...prev.foodInfo,
        tips: value,
      },
    }));
  };

  const handleSave = async () => {
    if (!recordId) {
      // Create a temporary record ID for manual entry
      const tempId = 'manual-' + Date.now();
      setRecordId(tempId);
    }

    setSaveLoading(true);
    try {
      const currentRecordId = recordId || 'manual-' + Date.now();
      if (!recordId) setRecordId(currentRecordId);

      await saveAudit({
        recordId: currentRecordId,
        manufacturerInfo: formState.manufacturerInfo,
        foodInfo: formState.foodInfo,
      });
      toast.success('保存成功');
    } catch (error) {
      toast.error('保存失败');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!recordId) {
      toast.error('请先保存信息');
      return;
    }

    setAuditLoading(true);
    try {
      const response = await verifyLabel({
        recordId,
        useCustomStandard: selectedStandards.includes('custom'),
      });
      setAuditResult(response.result);
      setAuditOpen(true);
      toast.success('审核完成');
    } catch (error) {
      toast.error('审核失败');
    } finally {
      setAuditLoading(false);
    }
  };

  const handleExport = async () => {
    if (!recordId) {
      toast.error('请先完成审核');
      return;
    }

    setExportLoading(true);
    try {
      const blob = await exportAuditReport(recordId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `审核报告_${recordId}.docx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success('报告导出成功');
    } catch (error) {
      toast.error('导出失败');
    } finally {
      setExportLoading(false);
    }
  };

  const handleReset = () => {
    setRecordId('');
    setFormState({
      manufacturerInfo: initialManufacturerInfo,
      foodInfo: initialFoodInfo,
    });
    setAuditResult(null);
    setAllergensInput('');
    setTipsInput('');
    setFormOpen(true);
    setAuditOpen(false);
  };

  const calculateSectionResults = (): SectionResult[] => {
    if (!auditResult) return [];

    const sections: SectionResult[] = [];

    const supplierItems = auditResult.nonComplianceItems.filter(
      (item) => item.content.includes('原料供应商') || item.content.includes('工厂')
    );
    sections.push({
      name: '原料供应商',
      status: supplierItems.length === 0 ? 'pass' : 'fail',
      items: supplierItems,
    });

    const delegatorItems = auditResult.nonComplianceItems.filter(
      (item) => item.content.includes('经销商') || item.content.includes('委托方')
    );
    sections.push({
      name: '委托方',
      status: delegatorItems.length === 0 ? 'pass' : 'fail',
      items: delegatorItems,
    });

    const entrustedItems = auditResult.nonComplianceItems.filter(
      (item) => item.content.includes('分装厂') || item.content.includes('被委托方')
    );
    sections.push({
      name: '被委托方',
      status: entrustedItems.length === 0 ? 'pass' : 'fail',
      items: entrustedItems,
    });

    const gbItems = auditResult.nonComplianceItems.filter(
      (item) => item.standard === 'GB7718-2025'
    );
    sections.push({
      name: 'GB7718-2025 食品标签',
      status: gbItems.length === 0 ? 'pass' : 'fail',
      items: gbItems,
    });

    const marsItems = auditResult.nonComplianceItems.filter(
      (item) => item.standard === 'mars' || item.standard === '玛氏标准'
    );
    sections.push({
      name: '玛氏标准',
      status: marsItems.length === 0 ? 'pass' : 'fail',
      items: marsItems,
    });

    return sections;
  };

  const renderManufacturerForm = () => (
    <div className="space-y-6">
      <div>
        <h4 className="text-base font-semibold mb-4">原料供应商</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="supplier-name">名称</Label>
            <Input
              id="supplier-name"
              value={formState.manufacturerInfo.rawMaterialSupplier.name}
              onChange={(e) =>
                handleNestedInputChange('manufacturerInfo', 'rawMaterialSupplier', 'name', e.target.value)
              }
              placeholder="请输入供应商名称"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="supplier-license">许可证号</Label>
            <Input
              id="supplier-license"
              value={formState.manufacturerInfo.rawMaterialSupplier.license || ''}
              onChange={(e) =>
                handleNestedInputChange('manufacturerInfo', 'rawMaterialSupplier', 'license', e.target.value)
              }
              placeholder="请输入许可证号"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="supplier-address">地址</Label>
            <Input
              id="supplier-address"
              value={formState.manufacturerInfo.rawMaterialSupplier.address}
              onChange={(e) =>
                handleNestedInputChange('manufacturerInfo', 'rawMaterialSupplier', 'address', e.target.value)
              }
              placeholder="请输入供应商地址"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="supplier-phone">联系电话</Label>
            <Input
              id="supplier-phone"
              value={formState.manufacturerInfo.rawMaterialSupplier.phone || ''}
              onChange={(e) =>
                handleNestedInputChange('manufacturerInfo', 'rawMaterialSupplier', 'phone', e.target.value)
              }
              placeholder="请输入联系电话"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="supplier-origin">产地</Label>
            <Input
              id="supplier-origin"
              value={formState.manufacturerInfo.rawMaterialSupplier.origin || ''}
              onChange={(e) =>
                handleNestedInputChange('manufacturerInfo', 'rawMaterialSupplier', 'origin', e.target.value)
              }
              placeholder="请输入产地"
            />
          </div>
        </div>
      </div>

      <div>
        <h4 className="text-base font-semibold mb-4">委托方</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="delegator-name">名称</Label>
            <Input
              id="delegator-name"
              value={formState.manufacturerInfo.delegator.name}
              onChange={(e) =>
                handleNestedInputChange('manufacturerInfo', 'delegator', 'name', e.target.value)
              }
              placeholder="请输入委托方名称"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="delegator-phone">联系电话</Label>
            <Input
              id="delegator-phone"
              value={formState.manufacturerInfo.delegator.phone}
              onChange={(e) =>
                handleNestedInputChange('manufacturerInfo', 'delegator', 'phone', e.target.value)
              }
              placeholder="请输入联系电话"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="delegator-address">地址</Label>
            <Input
              id="delegator-address"
              value={formState.manufacturerInfo.delegator.address}
              onChange={(e) =>
                handleNestedInputChange('manufacturerInfo', 'delegator', 'address', e.target.value)
              }
              placeholder="请输入委托方地址"
            />
          </div>
        </div>
      </div>

      <div>
        <h4 className="text-base font-semibold mb-4">被委托方（分装厂）</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="entrusted-name">名称</Label>
            <Input
              id="entrusted-name"
              value={formState.manufacturerInfo.entrustedParty.name}
              onChange={(e) =>
                handleNestedInputChange('manufacturerInfo', 'entrustedParty', 'name', e.target.value)
              }
              placeholder="请输入被委托方名称"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="entrusted-license">许可证号</Label>
            <Input
              id="entrusted-license"
              value={formState.manufacturerInfo.entrustedParty.license}
              onChange={(e) =>
                handleNestedInputChange('manufacturerInfo', 'entrustedParty', 'license', e.target.value)
              }
              placeholder="请输入许可证号"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="entrusted-address">地址</Label>
            <Input
              id="entrusted-address"
              value={formState.manufacturerInfo.entrustedParty.address}
              onChange={(e) =>
                handleNestedInputChange('manufacturerInfo', 'entrustedParty', 'address', e.target.value)
              }
              placeholder="请输入被委托方地址"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="entrusted-phone">联系电话</Label>
            <Input
              id="entrusted-phone"
              value={formState.manufacturerInfo.entrustedParty.phone || ''}
              onChange={(e) =>
                handleNestedInputChange('manufacturerInfo', 'entrustedParty', 'phone', e.target.value)
              }
              placeholder="请输入联系电话"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="entrusted-origin">产地</Label>
            <Input
              id="entrusted-origin"
              value={formState.manufacturerInfo.entrustedParty.origin || ''}
              onChange={(e) =>
                handleNestedInputChange('manufacturerInfo', 'entrustedParty', 'origin', e.target.value)
              }
              placeholder="请输入产地"
            />
          </div>
        </div>
      </div>
    </div>
  );

  const renderFoodForm = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="food-name">食品名称</Label>
          <Input
            id="food-name"
            value={formState.foodInfo.name}
            onChange={(e) => handleInputChange('foodInfo', 'name', e.target.value)}
            placeholder="请输入食品名称"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="food-type">食品类型</Label>
          <Input
            id="food-type"
            value={formState.foodInfo.type}
            onChange={(e) => handleInputChange('foodInfo', 'type', e.target.value)}
            
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="net-content">净含量</Label>
          <Input
            id="net-content"
            value={formState.foodInfo.netContent}
            onChange={(e) => handleInputChange('foodInfo', 'netContent', e.target.value)}
            placeholder="如：100g"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="production-date">生产日期</Label>
          <Input
            id="production-date"
            type="date"
            value={formState.foodInfo.productionDate || ''}
            onChange={(e) => handleInputChange('foodInfo', 'productionDate', e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="shelf-life">保质期</Label>
          <Input
            id="shelf-life"
            value={formState.foodInfo.shelfLife}
            onChange={(e) => handleInputChange('foodInfo', 'shelfLife', e.target.value)}
            placeholder="如：12个月"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="ingredients">配料表</Label>
        <Textarea
          id="ingredients"
          value={formState.foodInfo.ingredients}
          onChange={(e) => handleInputChange('foodInfo', 'ingredients', e.target.value)}
          placeholder="请输入配料表"
          rows={3}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="nutrition">营养成分表</Label>
        <Textarea
          id="nutrition"
          value={formState.foodInfo.nutrition || ''}
          onChange={(e) => handleInputChange('foodInfo', 'nutrition', e.target.value)}
          placeholder="请输入营养成分表"
          rows={3}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="storage-condition">贮存条件</Label>
        <Input
          id="storage-condition"
          value={formState.foodInfo.storageCondition}
          onChange={(e) => handleInputChange('foodInfo', 'storageCondition', e.target.value)}
          placeholder="请输入贮存条件"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="standard-code">产品标准号</Label>
          <Input
            id="standard-code"
            value={formState.foodInfo.standardCode}
            onChange={(e) => handleInputChange('foodInfo', 'standardCode', e.target.value)}
            placeholder="请输入产品标准号"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="allergens">致敏物质</Label>
          <Input
            id="allergens"
            value={allergensInput}
            onChange={(e) => handleAllergensChange(e.target.value)}
            placeholder="请输入致敏物质，用顿号分隔"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="tips">温馨提示</Label>
        <Textarea
          id="tips"
          value={tipsInput}
          onChange={(e) => handleTipsChange(e.target.value)}
          placeholder="请输入温馨提示或注意事项"
          rows={2}
        />
      </div>
    </div>
  );

  const renderAuditConfiguration = () => (
    <div className="space-y-4">
      <h4 className="text-base font-semibold">审核标准</h4>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Checkbox
            id="standard-mars"
            checked={selectedStandards.includes('mars')}
            onCheckedChange={() => handleStandardToggle('mars')}
          />
          <Label htmlFor="standard-mars" className="font-normal cursor-pointer">
            玛氏标准
          </Label>
        </div>
        <div className="ml-7 text-sm text-muted-foreground">
          <p>原料供应商必须匹配三家玛氏工厂之一</p>
          <p>经销商信息完整、被委托方信息完整</p>
        </div>

        <div className="flex items-center gap-3 mt-4">
          <Checkbox
            id="standard-gb7718"
            checked={selectedStandards.includes('gb7718')}
            onCheckedChange={() => handleStandardToggle('gb7718')}
          />
          <Label htmlFor="standard-gb7718" className="font-normal cursor-pointer">
            GB7718-2025
          </Label>
        </div>
        <div className="ml-7 text-sm text-muted-foreground">
          <p>强制标示项目完整</p>
          <p>食品名称、配料表、日期标示规范</p>
          <p>致敏物质提示规范</p>
        </div>
      </div>
    </div>
  );

  const renderAuditResults = () => {
    if (!auditResult) return null;

    const sectionResults = calculateSectionResults();
    const passCount = sectionResults.filter((s) => s.status === 'pass').length;
    const failCount = sectionResults.filter((s) => s.status === 'fail').length;

    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>审核结果</span>
              <Badge
                variant={auditResult.pass ? 'default' : 'destructive'}
                className="text-sm"
              >
                {auditResult.pass ? '通过' : '不通过'}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="text-center p-4 bg-success-bg rounded-lg">
                <p className="text-2xl font-bold text-success">{passCount}</p>
                <p className="text-sm text-muted-foreground">通过项</p>
              </div>
              <div className="text-center p-4 bg-destructive-bg rounded-lg">
                <p className="text-2xl font-bold text-destructive">{failCount}</p>
                <p className="text-sm text-muted-foreground">不通过项</p>
              </div>
              <div className="text-center p-4 bg-accent rounded-lg">
                <p className="text-2xl font-bold text-accent-foreground">
                  {auditResult.totalScore}
                </p>
                <p className="text-sm text-muted-foreground">总分</p>
              </div>
            </div>

            {sectionResults.map((section) => (
              <Collapsible key={section.name} defaultOpen={section.status === 'fail'}>
                <CollapsibleTrigger className="flex items-center justify-between w-full p-3 rounded-lg hover:bg-accent/50 transition-colors">
                  <div className="flex items-center gap-3">
                    {section.status === 'pass' ? (
                      <CheckCircle className="size-5 text-success" />
                    ) : (
                      <AlertTriangle className="size-5 text-destructive" />
                    )}
                    <span className="font-medium">{section.name}</span>
                  </div>
                  <ChevronDown className="size-4 text-muted-foreground" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  {section.items.length > 0 && (
                    <div className="ml-8 mt-2 space-y-2">
                      {section.items.map((item, idx) => (
                        <Alert key={idx} variant="destructive" className="py-3">
                          <AlertCircle className="size-4" />
                          <AlertTitle>{item.content}</AlertTitle>
                          <AlertDescription>{item.suggestion}</AlertDescription>
                        </Alert>
                      ))}
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <div className="container mx-auto max-w-[1400px] p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">手动审核</h1>
          <p className="text-sm text-muted-foreground mt-1">
            手动输入厂商信息和食品信息，提交后进行合规审核
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={handleReset}>
            重置
          </Button>
          <Button variant="outline" onClick={handleSave} disabled={saveLoading}>
            {saveLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            保存
          </Button>
          <Button
            variant="default"
            onClick={handleVerify}
            disabled={!recordId || auditLoading}
          >
            {auditLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            开始审核
          </Button>
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={!auditResult || exportLoading}
          >
            {exportLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            导出报告
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Form Input */}
        <div className="space-y-6">
          <Collapsible open={formOpen} onOpenChange={setFormOpen}>
            <Card>
              <CardHeader className="pb-3">
                <CollapsibleTrigger className="flex items-center justify-between w-full">
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    信息填写
                  </CardTitle>
                  {formOpen ? (
                    <ChevronDown className="size-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-4 text-muted-foreground" />
                  )}
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent>
                  <Tabs defaultValue="manufacturer">
                    <TabsList className="w-full mb-4">
                      <TabsTrigger value="manufacturer" className="flex-1">
                        <Building2 className="mr-2 h-4 w-4" />
                        厂商信息
                      </TabsTrigger>
                      <TabsTrigger value="food" className="flex-1">
                        <Package className="mr-2 h-4 w-4" />
                        食品信息
                      </TabsTrigger>
                      <TabsTrigger value="standards" className="flex-1">
                        <Settings className="mr-2 h-4 w-4" />
                        审核标准
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="manufacturer">
                      {renderManufacturerForm()}
                    </TabsContent>

                    <TabsContent value="food">{renderFoodForm()}</TabsContent>

                    <TabsContent value="standards">
                      {renderAuditConfiguration()}
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </div>

        {/* Right: Audit Results */}
        <div className="space-y-6">
          {auditResult ? (
            renderAuditResults()
          ) : (
            <Card>
              <CardContent className="p-12 text-center">
                <ScrollText className="size-16 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">等待审核</h3>
                <p className="text-sm text-muted-foreground">
                  填写完厂商信息和食品信息后，点击「开始审核」进行合规检查
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default AuditManualPage;
