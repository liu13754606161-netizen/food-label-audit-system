import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Building2,
  ScrollText,
  Package,
  Settings,
  Save,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getRecordById, verifyLabel, saveAudit } from '@/api';
import { toast } from 'sonner';
import type { RecordDetailResp, NonComplianceItem, ManufacturerInfo, FoodInfo } from '@shared/api.interface';

type SectionKey = 'supplier' | 'delegator' | 'entrusted' | 'gb7718';

interface SectionConfig {
  key: SectionKey;
  name: string;
  icon: React.ReactNode;
  filterFn: (item: NonComplianceItem) => boolean;
}

const SECTION_CONFIGS: SectionConfig[] = [
  {
    key: 'supplier',
    name: '原料供应商',
    icon: <Building2 className="size-4" />,
    filterFn: (item) =>
      item.content.includes('原料供应商') || item.content.includes('工厂'),
  },
  {
    key: 'delegator',
    name: '委托方',
    icon: <Building2 className="size-4" />,
    filterFn: (item) =>
      item.content.includes('经销商') || item.content.includes('委托方'),
  },
  {
    key: 'entrusted',
    name: '被委托方',
    icon: <Building2 className="size-4" />,
    filterFn: (item) =>
      item.content.includes('分装厂') ||
      item.content.includes('被委托方') ||
      item.content.includes('受委托方'),
  },
  {
    key: 'gb7718',
    name: 'GB7718-2025',
    icon: <ScrollText className="size-4" />,
    filterFn: (item) => item.standard === 'GB7718-2025',
  },
];

const AuditQuickPage: React.FC = () => {
  const { recordId } = useParams<{ recordId: string }>();
  const navigate = useNavigate();
  const [record, setRecord] = useState<RecordDetailResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SectionKey | 'all'>('all');
  const [auditLoading, setAuditLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [auditTriggered, setAuditTriggered] = useState(false);

  useEffect(() => {
    if (!recordId) {
      setError('记录ID不存在');
      setLoading(false);
      return;
    }

    const fetchRecord = async () => {
      try {
        setLoading(true);
        const data = await getRecordById(recordId);
        setRecord(data);
      } catch {
        setError('获取记录详情失败');
      } finally {
        setLoading(false);
      }
    };

    fetchRecord();
  }, [recordId]);

  const handleVerify = async () => {
    if (!recordId) return;

    setAuditLoading(true);
    try {
      const response = await verifyLabel({
        recordId,
        useCustomStandard: false,
      });
      // Refresh record to get updated audit result
      const updatedRecord = await getRecordById(recordId);
      setRecord(updatedRecord);
      setAuditTriggered(true);
      toast.success('审核完成');
    } catch {
      toast.error('审核失败');
    } finally {
      setAuditLoading(false);
    }
  };

  const handleSave = async () => {
    if (!recordId || !record?.rawData) return;

    setSaveLoading(true);
    try {
      await saveAudit({
        recordId,
        manufacturerInfo: record.rawData.manufacturerInfo as ManufacturerInfo,
        foodInfo: record.rawData.foodInfo as FoodInfo,
      });
      toast.success('保存成功');
    } catch {
      toast.error('保存失败');
    } finally {
      setSaveLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-muted-foreground">加载中...</p>
        </div>
      </div>
    );
  }

  if (error || !record) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-[1400px] mx-auto">
          <Button variant="ghost" onClick={() => navigate('/audit')} className="mb-4">
            <ArrowLeft className="size-4 mr-2" />
            返回审核
          </Button>
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>加载失败</AlertTitle>
            <AlertDescription>{error || '记录不存在'}</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  const auditResult = record.resultData?.auditResult;
  const foodInfo = record.rawData?.foodInfo;
  const manufacturerInfo = record.rawData?.manufacturerInfo;

  const getFilteredItems = (section: SectionKey | 'all'): NonComplianceItem[] => {
    if (!auditResult) return [];
    if (section === 'all') return auditResult.nonComplianceItems;
    const config = SECTION_CONFIGS.find((s) => s.key === section);
    return config
      ? auditResult.nonComplianceItems.filter(config.filterFn)
      : [];
  };

  const getSectionStatus = (section: SectionKey): 'pass' | 'fail' => {
    if (!auditResult) return 'pass';
    const items = getFilteredItems(section);
    return items.length === 0 ? 'pass' : 'fail';
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1400px] mx-auto p-6 lg:p-8">
        {/* 顶部导航 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => navigate('/audit')}>
              <ArrowLeft className="size-4 mr-2" />
              返回审核
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">快速审核结果</h1>
              <p className="text-sm text-muted-foreground mt-1">
                记录ID: {recordId} | 文件: {record.fileName}
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={handleSave}
              disabled={saveLoading}
            >
              {saveLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
              <Save className="mr-2 size-4" />
              保存记录
            </Button>
            {!auditResult && (
              <Button
                onClick={handleVerify}
                disabled={auditLoading}
              >
                {auditLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
                开始审核
              </Button>
            )}
          </div>
        </div>

        {/* 未审核提示 */}
        {!auditResult && !auditLoading && (
          <Alert className="mb-6">
            <AlertCircle className="size-4" />
            <AlertTitle>尚未执行审核</AlertTitle>
            <AlertDescription>
              请点击右上角「开始审核」按钮执行合规性检查。
            </AlertDescription>
          </Alert>
        )}

        {/* 审核中状态 */}
        {auditLoading && (
          <Card className="mb-6">
            <CardContent className="p-8 flex flex-col items-center gap-3">
              <Loader2 className="size-10 animate-spin text-primary" />
              <p className="text-muted-foreground">正在执行审核...</p>
            </CardContent>
          </Card>
        )}

        {/* 审核结果 */}
        {auditResult && (
          <>
            {/* 总体状态 */}
            <Card className="mb-6">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {auditResult.pass ? (
                      <CheckCircle className="size-10 text-success" />
                    ) : (
                      <AlertCircle className="size-10 text-destructive" />
                    )}
                    <div>
                      <h2 className="text-lg font-semibold">
                        {auditResult.pass ? '审核通过' : '审核不通过'}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        综合得分 {auditResult.totalScore} 分
                        {!auditResult.pass &&
                          `，共 ${auditResult.nonComplianceItems.length} 项不符合`}
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant={auditResult.pass ? 'default' : 'destructive'}
                    className="text-sm px-4 py-1"
                  >
                    {auditResult.pass ? '通过' : '不通过'}
                  </Badge>
                </div>

                {/* 食品信息摘要 */}
                {foodInfo && (
                  <div className="mt-4 pt-4 border-t grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">食品名称：</span>
                      <span className="font-medium">{foodInfo.name}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">净含量：</span>
                      <span className="font-medium">{foodInfo.netContent}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">保质期：</span>
                      <span className="font-medium">{foodInfo.shelfLife}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 各部分导航 + 详情 */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              {/* 左侧导航 */}
              <Card className="lg:col-span-1 h-fit">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">审核部分</CardTitle>
                </CardHeader>
                <CardContent className="p-3">
                  <div className="space-y-1">
                    <button
                      onClick={() => setActiveSection('all')}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                        activeSection === 'all'
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-accent'
                      }`}
                    >
                      <Package className="size-4" />
                      <span className="flex-1 text-left">全部</span>
                      <Badge
                        variant={
                          auditResult.nonComplianceItems.length === 0
                            ? 'outline'
                            : 'destructive'
                        }
                        className="text-xs"
                      >
                        {auditResult.nonComplianceItems.length}项
                      </Badge>
                    </button>

                    {SECTION_CONFIGS.map((section) => {
                      const status = getSectionStatus(section.key);
                      const items = getFilteredItems(section.key);
                      return (
                        <button
                          key={section.key}
                          onClick={() => setActiveSection(section.key)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                            activeSection === section.key
                              ? 'bg-primary text-primary-foreground'
                              : 'hover:bg-accent'
                          }`}
                        >
                          {section.icon}
                          <span className="flex-1 text-left">{section.name}</span>
                          {status === 'pass' ? (
                            <CheckCircle className="size-4 text-success" />
                          ) : (
                            <Badge variant="destructive" className="text-xs">
                              {items.length}项
                            </Badge>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* 右侧详情 */}
              <div className="lg:col-span-3">
                {activeSection === 'all' ? (
                  <Tabs defaultValue="all" className="w-full">
                    <TabsList className="w-full mb-4">
                      <TabsTrigger value="all" className="flex-1">
                        全部不合规项
                      </TabsTrigger>
                      {SECTION_CONFIGS.map((section) => (
                        <TabsTrigger
                          key={section.key}
                          value={section.key}
                          className="flex-1"
                          onClick={() => setActiveSection(section.key)}
                        >
                          {section.name}
                        </TabsTrigger>
                      ))}
                    </TabsList>

                    <TabsContent value="all" className="mt-0">
                      {renderNonComplianceList(auditResult.nonComplianceItems)}
                    </TabsContent>
                    {SECTION_CONFIGS.map((section) => (
                      <TabsContent key={section.key} value={section.key} className="mt-0">
                        {renderNonComplianceList(getFilteredItems(section.key))}
                      </TabsContent>
                    ))}
                  </Tabs>
                ) : (
                  renderNonComplianceList(getFilteredItems(activeSection))
                )}
              </div>
            </div>
          </>
        )}

        {/* 厂商信息摘要（无审核结果时展示） */}
        {!auditResult && manufacturerInfo && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="size-4" />
                  原料供应商
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div><span className="text-muted-foreground">名称：</span>{manufacturerInfo.rawMaterialSupplier.name || '-'}</div>
                <div><span className="text-muted-foreground">地址：</span>{manufacturerInfo.rawMaterialSupplier.address || '-'}</div>
                <div><span className="text-muted-foreground">许可证：</span>{manufacturerInfo.rawMaterialSupplier.license || '-'}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="size-4" />
                  委托方
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div><span className="text-muted-foreground">名称：</span>{manufacturerInfo.delegator.name || '-'}</div>
                <div><span className="text-muted-foreground">地址：</span>{manufacturerInfo.delegator.address || '-'}</div>
                <div><span className="text-muted-foreground">电话：</span>{manufacturerInfo.delegator.phone || '-'}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Settings className="size-4" />
                  被委托方
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div><span className="text-muted-foreground">名称：</span>{manufacturerInfo.entrustedParty.name || '-'}</div>
                <div><span className="text-muted-foreground">地址：</span>{manufacturerInfo.entrustedParty.address || '-'}</div>
                <div><span className="text-muted-foreground">许可证：</span>{manufacturerInfo.entrustedParty.license || '-'}</div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};

function renderNonComplianceList(items: NonComplianceItem[]) {
  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <CheckCircle className="size-12 mx-auto mb-4 text-success" />
          <p className="text-lg font-medium text-success">该部分审核通过</p>
          <p className="text-sm text-muted-foreground mt-1">
            未发现不符合标准的问题
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <Card key={index} className="border-border overflow-hidden">
          <CardContent className="p-0">
            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
              <div className="p-4 bg-muted/30">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className="text-xs shrink-0">
                    {item.standard}
                  </Badge>
                </div>
                <p className="text-sm">
                  <span className="text-muted-foreground">问题：</span>
                  {item.content}
                </p>
              </div>
              <div className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="size-4 text-warning shrink-0" />
                  <span className="text-sm font-medium text-warning">
                    整改建议
                  </span>
                </div>
                <p className="text-sm whitespace-pre-line">{item.suggestion}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default AuditQuickPage;
