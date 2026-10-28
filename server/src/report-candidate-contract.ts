/** User-supplied attachment candidates only; never a live K3 request contract. */
export type ReportCandidateField = { label: string; key: string }
export type ReportCandidateParameter = { label: string; key: string; requiredCandidate: boolean }
export type ReportCandidate = {
  id: string; name: string; formId: string; method: 'GetSysReportData'; status: 'candidate_unverified_locked';
  liveState: 'unverified'; executionStatus: 'locked'; methodEvidence: 'attachment_example';
  publicApiClassification: 'unverified'; targetAccountValidation: 'unverified'; schemeId: null; selectedFieldKeys: null;
  sourceAttachment: string | null; requestedAttachment: string | null; sourceAttachmentMatchesRequestedPath: boolean | null;
  sourceReportedFormId: string | null; sourceMatchesRequestedFormId: boolean;
  /** Input/filter descriptions from the attachment's Model section, separate from visible output columns. */
  parameterFields: ReportCandidateParameter[];
  /** Exact top-level property names in the attachment JSON Model; no runtime values/enums are inferred. */
  modelFieldKeys: string[];
  /** Nested Model paths, e.g. FEntAgingGrpSetting[].FSection and FEntAgingGrpSetting[].FDays. */
  modelNestedFieldPaths: string[];
  /** Visible output list under the attachment's FieldKeys section; candidates only, not selected request FieldKeys. */
  fieldCandidates: ReportCandidateField[]; candidateFieldKeys: string[];
  localRowsAvailable: boolean; interpretationConstraints: string[];
  validation: { source: string; attachmentMethodDemonstrated: true; publicApiClassificationVerified: false; targetLedgerValidated: false; schemeIdValidated: false; fieldKeysSelected: false; requiredEnumsValidated: false; responseEnvelopeValidated: false; rowGrainValidated: false; liveCallAllowed: false };
  blockers: string[]
}
export const REPORT_CANDIDATES: ReportCandidate[] = [
  {
    "id": "purchase-order-detail",
    "name": "采购订单执行明细",
    "formId": "PUR_PurchaseOrderDetailRpt",
    "method": "GetSysReportData",
    "status": "candidate_unverified_locked",
    "liveState": "unverified",
    "executionStatus": "locked",
    "methodEvidence": "attachment_example",
    "publicApiClassification": "unverified",
    "targetAccountValidation": "unverified",
    "schemeId": null,
    "selectedFieldKeys": null,
    "sourceAttachment": null,
    "requestedAttachment": null,
    "sourceAttachmentMatchesRequestedPath": null,
    "sourceReportedFormId": "PUR_PurchaseOrderDetailRpt",
    "sourceMatchesRequestedFormId": true,
    "parameterFields": [
      {
        "label": "订单日期",
        "key": "FOrderStartDate",
        "requiredCandidate": true
      },
      {
        "label": "至",
        "key": "FOrderEndDate",
        "requiredCandidate": true
      },
      {
        "label": "业务类型",
        "key": "FBusinessType",
        "requiredCandidate": true
      },
      {
        "label": "单据状态",
        "key": "FDocumentStatus",
        "requiredCandidate": true
      },
      {
        "label": "采购组织",
        "key": "FPurchaseOrgIdList",
        "requiredCandidate": true
      },
      {
        "label": "至",
        "key": "FEndFPurchaser",
        "requiredCandidate": false
      },
      {
        "label": "至",
        "key": "FEndBillNumber",
        "requiredCandidate": false
      },
      {
        "label": "至",
        "key": "FEndSupplierId",
        "requiredCandidate": false
      },
      {
        "label": "供应商编码",
        "key": "FBeginSupplierId",
        "requiredCandidate": false
      },
      {
        "label": "至",
        "key": "FEndMaterialId",
        "requiredCandidate": false
      },
      {
        "label": "采购员编码",
        "key": "FBeginPurchaser",
        "requiredCandidate": false
      },
      {
        "label": "订单编号",
        "key": "FBeginBillNumber",
        "requiredCandidate": false
      },
      {
        "label": "物料编码",
        "key": "FBeginMaterialId",
        "requiredCandidate": false
      },
      {
        "label": "行状态",
        "key": "FLineStatus",
        "requiredCandidate": true
      }
    ],
    "modelFieldKeys": [
      "FPurchaseOrgIdList",
      "FOrderStartDate",
      "FOrderEndDate",
      "FBeginSupplierId",
      "FEndSupplierId",
      "FBeginBillNumber",
      "FEndBillNumber",
      "FBeginMaterialId",
      "FEndMaterialId",
      "FBeginPurchaser",
      "FEndFPurchaser",
      "FBusinessType",
      "FDocumentStatus",
      "FLineStatus"
    ],
    "modelNestedFieldPaths": [
      "FBeginSupplierId.FNumber",
      "FEndSupplierId.FNumber",
      "FBeginMaterialId.FNumber",
      "FEndMaterialId.FNumber",
      "FBeginPurchaser.FNumber",
      "FEndFPurchaser.FNumber"
    ],
    "fieldCandidates": [
      {
        "label": "采购组织",
        "key": "FPurchaseOrgId"
      },
      {
        "label": "采购组",
        "key": "FPURCHASERGROUPID"
      },
      {
        "label": "采购部门",
        "key": "FPURCHASEDEPTID"
      },
      {
        "label": "采购员",
        "key": "FPURCHASERID"
      },
      {
        "label": "订单编号",
        "key": "FBillNo"
      },
      {
        "label": "日期",
        "key": "FDate"
      },
      {
        "label": "供应商编码",
        "key": "FSUPPLIERID"
      },
      {
        "label": "供应商名称",
        "key": "FSUPPLIERNAME"
      },
      {
        "label": "供应商分组",
        "key": "FSupplierGroup"
      },
      {
        "label": "订单行号",
        "key": "FBillSeqId"
      },
      {
        "label": "物料编码",
        "key": "FMATERIALID"
      },
      {
        "label": "物料名称",
        "key": "FMATERIALNAME"
      },
      {
        "label": "计划跟踪号",
        "key": "FMTONO"
      },
      {
        "label": "规格型号",
        "key": "FMaterialModel"
      },
      {
        "label": "存货类别",
        "key": "FCategoryID"
      },
      {
        "label": "物料属性",
        "key": "FErpClsID"
      },
      {
        "label": "物料分组",
        "key": "FMaterialGroup"
      },
      {
        "label": "辅助属性",
        "key": "FFLEX"
      },
      {
        "label": "源单编号",
        "key": "FSrcBillNo"
      },
      {
        "label": "源单类型",
        "key": "FSRCBILLTYPENAME"
      },
      {
        "label": "交货日期",
        "key": "FDELIVERYDATE"
      },
      {
        "label": "需求组织",
        "key": "FREQUIREORGID"
      },
      {
        "label": "需求部门",
        "key": "FREQUIREDEPTID"
      },
      {
        "label": "采购单位",
        "key": "FUnitId"
      },
      {
        "label": "结算币别",
        "key": "FCurrencyId"
      },
      {
        "label": "本位币",
        "key": "FCURRENCYID_LC"
      },
      {
        "label": "计价单位",
        "key": "FPRICEUNITID"
      },
      {
        "label": "订货数量",
        "key": "FOrderQty"
      },
      {
        "label": "订货数量(计价单位)",
        "key": "FORDERPRICEQTY"
      },
      {
        "label": "含税单价",
        "key": "FTAXPRICE"
      },
      {
        "label": "含税单价(本位币)",
        "key": "FTAXPRICE_LC"
      },
      {
        "label": "价税合计",
        "key": "FOrderAmount"
      },
      {
        "label": "价税合计(本位币)",
        "key": "FORDERAMOUNT_LC"
      },
      {
        "label": "收料单号",
        "key": "FReceiveNumber"
      },
      {
        "label": "收料日期",
        "key": "FReceiveDate"
      },
      {
        "label": "收料单行号",
        "key": "FRECEIVESEQID"
      },
      {
        "label": "收料数量",
        "key": "FReceiveQty"
      },
      {
        "label": "收料数量(计价单位)",
        "key": "FRECEIVEPRICEQTY"
      },
      {
        "label": "收料金额",
        "key": "FReceiveAmount"
      },
      {
        "label": "收料金额(本位币)",
        "key": "FRECEIVEAMOUNT_LC"
      },
      {
        "label": "入库单号",
        "key": "FEnterNumber"
      },
      {
        "label": "入库日期",
        "key": "FEnterDate"
      },
      {
        "label": "入库单行号",
        "key": "FINSTOCKSEQID"
      },
      {
        "label": "入库数量",
        "key": "FImportQty"
      },
      {
        "label": "入库数量(计价单位)",
        "key": "FIMPORTPRICEQTY"
      },
      {
        "label": "入库金额",
        "key": "FImportAmount"
      },
      {
        "label": "入库金额(本位币)",
        "key": "FIMPORTAMOUNT_LC"
      },
      {
        "label": "入库不含税金额",
        "key": "FIMPORTNOTAXAMOUNT"
      },
      {
        "label": "入库不含税金额(本位币)",
        "key": "FIMPORTNOTAXAMOUNT_LC"
      },
      {
        "label": "退料单号",
        "key": "FReturnNumber"
      },
      {
        "label": "退料日期",
        "key": "FReturnDate"
      },
      {
        "label": "退料单行号",
        "key": "FRETURNSEQID"
      },
      {
        "label": "退料数量",
        "key": "FReturnQty"
      },
      {
        "label": "退料数量(计价单位)",
        "key": "FRETURNPRICEQTY"
      },
      {
        "label": "退料金额",
        "key": "FReturnAmount"
      },
      {
        "label": "退料金额(本位币)",
        "key": "FRETURNAMOUNT_LC"
      },
      {
        "label": "应付单号",
        "key": "FPAYNUMBER"
      },
      {
        "label": "应付日期",
        "key": "FPAYDATE"
      },
      {
        "label": "应付单行号",
        "key": "FPAYSEQID"
      },
      {
        "label": "立账类型",
        "key": "FSETACCOUNTTYPE"
      },
      {
        "label": "应付数量",
        "key": "FPAYQTY"
      },
      {
        "label": "应付数量(计价单位)",
        "key": "FPAYPRICEQTY"
      },
      {
        "label": "应付金额",
        "key": "FPAYAMOUNT"
      },
      {
        "label": "应付不含税金额",
        "key": "FPAYEXTAXAMOUNT"
      },
      {
        "label": "应付金额(本位币)",
        "key": "FPAYAMOUNT_LC"
      },
      {
        "label": "调整金额",
        "key": "FPAYWOFFAMOUNT"
      },
      {
        "label": "应付调整金额(本位币)",
        "key": "FPAYWOFFAMOUNT_LC"
      },
      {
        "label": "开票单号",
        "key": "FINVOICENUMBER"
      },
      {
        "label": "开票数量",
        "key": "FINVOICEQTY"
      },
      {
        "label": "开票金额",
        "key": "FINVOICEAMOUNT"
      },
      {
        "label": "开票金额(本位币)",
        "key": "FINVOICEAMOUNT_LC"
      },
      {
        "label": "预付单号",
        "key": "FRECPAYBILLNUMBER"
      },
      {
        "label": "预付金额",
        "key": "FRECPAYBILLAMOUNT"
      },
      {
        "label": "预付金额(本位币)",
        "key": "FRECPAYBILLAMOUNT_LC"
      },
      {
        "label": "行业务终止",
        "key": "FMRPTERMINATESTATUS"
      },
      {
        "label": "付款单号",
        "key": "FPAYBILLNUMBER"
      },
      {
        "label": "付款日期",
        "key": "FPAYBILLDATE"
      },
      {
        "label": "已结算金额",
        "key": "FPAYBILLAMOUNT"
      },
      {
        "label": "已结算金额(本位币)",
        "key": "FPAYBILLAMOUNT_LC"
      },
      {
        "label": "关联保证金",
        "key": "FRELATEDEPOSIT"
      },
      {
        "label": "行业务关闭",
        "key": "FMRPCLOSESTATUS"
      },
      {
        "label": "关联申请保证金",
        "key": "FAPPLYRELATEDEPOSIT"
      },
      {
        "label": "关联退款保证金",
        "key": "FRELATEREFUNDDEPOSIT"
      },
      {
        "label": "整单关闭",
        "key": "FCLOSESTATUS"
      },
      {
        "label": "行业务冻结",
        "key": "FMRPFREEZESTATUS"
      },
      {
        "label": "发票号",
        "key": "FINVOICENO"
      },
      {
        "label": "发票日期",
        "key": "FINVOICEDATE"
      },
      {
        "label": "结算调整金额",
        "key": "FSETADJAMOUNT"
      },
      {
        "label": "付款核销金额",
        "key": "FPAYWRITOFFAMOUNT"
      },
      {
        "label": "特殊冲销金额",
        "key": "FSPEWOFFAMOUNT"
      },
      {
        "label": "已付款金额(接口)",
        "key": "FINTEPAYAMOUNT"
      },
      {
        "label": "结算调整金(本位币)",
        "key": "FSETADJAMOUNT_LC"
      },
      {
        "label": "付款核销金额(本位币)",
        "key": "FPAYWRITOFFAMOUNT_LC"
      },
      {
        "label": "特殊冲销金额(本位币)",
        "key": "FSPEWOFFAMOUNT_LC"
      },
      {
        "label": "已付款金额(接口)(本位币)",
        "key": "FINTEPAYAMOUNT_LC"
      },
      {
        "label": "先开票单号",
        "key": "FPREINVOCEBILLNO"
      },
      {
        "label": "先开票发票日期",
        "key": "FPREINVOICEDATE"
      },
      {
        "label": "先开票数量",
        "key": "FPREINVOICEQTY"
      },
      {
        "label": "先开票金额",
        "key": "FPREINVOICEAMOUNT"
      },
      {
        "label": "先开票发票号",
        "key": "FPREINVOICENO"
      },
      {
        "label": "先开票金额(本位币)",
        "key": "FPREINVOICEAMOUNT_LC"
      }
    ],
    "candidateFieldKeys": [
      "FPurchaseOrgId",
      "FPURCHASERGROUPID",
      "FPURCHASEDEPTID",
      "FPURCHASERID",
      "FBillNo",
      "FDate",
      "FSUPPLIERID",
      "FSUPPLIERNAME",
      "FSupplierGroup",
      "FBillSeqId",
      "FMATERIALID",
      "FMATERIALNAME",
      "FMTONO",
      "FMaterialModel",
      "FCategoryID",
      "FErpClsID",
      "FMaterialGroup",
      "FFLEX",
      "FSrcBillNo",
      "FSRCBILLTYPENAME",
      "FDELIVERYDATE",
      "FREQUIREORGID",
      "FREQUIREDEPTID",
      "FUnitId",
      "FCurrencyId",
      "FCURRENCYID_LC",
      "FPRICEUNITID",
      "FOrderQty",
      "FORDERPRICEQTY",
      "FTAXPRICE",
      "FTAXPRICE_LC",
      "FOrderAmount",
      "FORDERAMOUNT_LC",
      "FReceiveNumber",
      "FReceiveDate",
      "FRECEIVESEQID",
      "FReceiveQty",
      "FRECEIVEPRICEQTY",
      "FReceiveAmount",
      "FRECEIVEAMOUNT_LC",
      "FEnterNumber",
      "FEnterDate",
      "FINSTOCKSEQID",
      "FImportQty",
      "FIMPORTPRICEQTY",
      "FImportAmount",
      "FIMPORTAMOUNT_LC",
      "FIMPORTNOTAXAMOUNT",
      "FIMPORTNOTAXAMOUNT_LC",
      "FReturnNumber",
      "FReturnDate",
      "FRETURNSEQID",
      "FReturnQty",
      "FRETURNPRICEQTY",
      "FReturnAmount",
      "FRETURNAMOUNT_LC",
      "FPAYNUMBER",
      "FPAYDATE",
      "FPAYSEQID",
      "FSETACCOUNTTYPE",
      "FPAYQTY",
      "FPAYPRICEQTY",
      "FPAYAMOUNT",
      "FPAYEXTAXAMOUNT",
      "FPAYAMOUNT_LC",
      "FPAYWOFFAMOUNT",
      "FPAYWOFFAMOUNT_LC",
      "FINVOICENUMBER",
      "FINVOICEQTY",
      "FINVOICEAMOUNT",
      "FINVOICEAMOUNT_LC",
      "FRECPAYBILLNUMBER",
      "FRECPAYBILLAMOUNT",
      "FRECPAYBILLAMOUNT_LC",
      "FMRPTERMINATESTATUS",
      "FPAYBILLNUMBER",
      "FPAYBILLDATE",
      "FPAYBILLAMOUNT",
      "FPAYBILLAMOUNT_LC",
      "FRELATEDEPOSIT",
      "FMRPCLOSESTATUS",
      "FAPPLYRELATEDEPOSIT",
      "FRELATEREFUNDDEPOSIT",
      "FCLOSESTATUS",
      "FMRPFREEZESTATUS",
      "FINVOICENO",
      "FINVOICEDATE",
      "FSETADJAMOUNT",
      "FPAYWRITOFFAMOUNT",
      "FSPEWOFFAMOUNT",
      "FINTEPAYAMOUNT",
      "FSETADJAMOUNT_LC",
      "FPAYWRITOFFAMOUNT_LC",
      "FSPEWOFFAMOUNT_LC",
      "FINTEPAYAMOUNT_LC",
      "FPREINVOCEBILLNO",
      "FPREINVOICEDATE",
      "FPREINVOICEQTY",
      "FPREINVOICEAMOUNT",
      "FPREINVOICENO",
      "FPREINVOICEAMOUNT_LC"
    ],
    "localRowsAvailable": true,
    "interpretationConstraints": [
      "字段说明、Model 与 FieldKeys 仅取自本项指定附件；不可与其他 FormId 报告互套。",
      "示例未验证目标账套、公开方法分类、筛选口径、单位/币别口径或行粒度。"
    ],
    "validation": {
      "source": "用户附件中的 GetSysReportData 示例；仅证明附件展示该方法调用，不构成公开API分类或目标账套验证。",
      "attachmentMethodDemonstrated": true,
      "publicApiClassificationVerified": false,
      "targetLedgerValidated": false,
      "schemeIdValidated": false,
      "fieldKeysSelected": false,
      "requiredEnumsValidated": false,
      "responseEnvelopeValidated": false,
      "rowGrainValidated": false,
      "liveCallAllowed": false
    },
    "blockers": [
      "附件示例请求的SchemeId与顶层FieldKeys留空；附件显示列清单已独立保留为输出候选，尚未选入请求或验证。",
      "附件标注的必填单选/枚举值域及目标账套校验方式未验证。",
      "响应 envelope、RowCount、Rows 的实际形态和行粒度未在目标账套验证。",
      "目标账套的报表字段、方法可用性、权限及组织范围均未验证。",
      "本候选中没有可展示的本地业务行；仅采购与销售明细由独立本地 demo fixture 提供。"
    ]
  },
  {
    "id": "sales-detail",
    "name": "销售执行明细",
    "formId": "SAL_DetailReport",
    "method": "GetSysReportData",
    "status": "candidate_unverified_locked",
    "liveState": "unverified",
    "executionStatus": "locked",
    "methodEvidence": "attachment_example",
    "publicApiClassification": "unverified",
    "targetAccountValidation": "unverified",
    "schemeId": null,
    "selectedFieldKeys": null,
    "sourceAttachment": null,
    "requestedAttachment": null,
    "sourceAttachmentMatchesRequestedPath": null,
    "sourceReportedFormId": "SAL_DetailReport",
    "sourceMatchesRequestedFormId": true,
    "parameterFields": [
      {
        "label": "单据状态",
        "key": "FFormStatus",
        "requiredCandidate": true
      },
      {
        "label": "整单关闭状态",
        "key": "FFormCloseStatus",
        "requiredCandidate": true
      },
      {
        "label": "行业务关闭状态",
        "key": "FBusCloseStatus",
        "requiredCandidate": true
      },
      {
        "label": "至",
        "key": "FSaleOTo",
        "requiredCandidate": false
      },
      {
        "label": "至",
        "key": "FMaterialTo",
        "requiredCandidate": false
      },
      {
        "label": "至",
        "key": "FCustomerTo",
        "requiredCandidate": false
      },
      {
        "label": "销售员编码",
        "key": "FSalesFrom",
        "requiredCandidate": false
      },
      {
        "label": "客户编码",
        "key": "FCustomerFrom",
        "requiredCandidate": false
      },
      {
        "label": "币别",
        "key": "FMoneyType",
        "requiredCandidate": false
      },
      {
        "label": "要货日期",
        "key": "FDelliveryDateFrom",
        "requiredCandidate": false
      },
      {
        "label": "至",
        "key": "FSoToDate",
        "requiredCandidate": true
      },
      {
        "label": "销售订单",
        "key": "FSaleOFrom",
        "requiredCandidate": false
      },
      {
        "label": "至",
        "key": "FDelliveryDateTo",
        "requiredCandidate": false
      },
      {
        "label": "组织",
        "key": "FSaleOrgList",
        "requiredCandidate": true
      },
      {
        "label": "订单日期",
        "key": "FSoFromDate",
        "requiredCandidate": true
      },
      {
        "label": "物料编码",
        "key": "FMaterialFrom",
        "requiredCandidate": false
      },
      {
        "label": "至",
        "key": "FSalesTo",
        "requiredCandidate": false
      },
      {
        "label": "查询时不合并展示订单的表头信息",
        "key": "FMergingSOHeader",
        "requiredCandidate": false
      },
      {
        "label": "包含未执行的销售订单",
        "key": "FIncludedUnfilledOrders",
        "requiredCandidate": false
      },
      {
        "label": "单价来源",
        "key": "FPriceFrom",
        "requiredCandidate": true
      },
      {
        "label": "按物料明细收款方式查询",
        "key": "FIsRecWithMat",
        "requiredCandidate": false
      },
      {
        "label": "客户分组",
        "key": "FCustGroup",
        "requiredCandidate": false
      },
      {
        "label": "统计套件",
        "key": "FSuite",
        "requiredCandidate": true
      },
      {
        "label": "立账类型",
        "key": "FSetAccountType",
        "requiredCandidate": true
      },
      {
        "label": "集团客户",
        "key": "FIsGroup",
        "requiredCandidate": false
      },
      {
        "label": "包含赠品",
        "key": "FIncludedFree",
        "requiredCandidate": false
      }
    ],
    "modelFieldKeys": [
      "FSaleOrgList",
      "FMoneyType",
      "FSoFromDate",
      "FSoToDate",
      "FCustomerFrom",
      "FCustomerTo",
      "FSalesFrom",
      "FSalesTo",
      "FMaterialFrom",
      "FMaterialTo",
      "FSaleOFrom",
      "FSaleOTo",
      "FDelliveryDateFrom",
      "FDelliveryDateTo",
      "FFormCloseStatus",
      "FFormStatus",
      "FPriceFrom",
      "FBusCloseStatus",
      "FMergingSOHeader",
      "FIncludedUnfilledOrders",
      "FIsRecWithMat",
      "FCustGroup",
      "FSuite",
      "FSetAccountType",
      "FIsGroup",
      "FIncludedFree"
    ],
    "modelNestedFieldPaths": [
      "FMoneyType.FNumber",
      "FCustomerFrom.FNumber",
      "FCustomerTo.FNumber",
      "FSalesFrom.FNumber",
      "FSalesTo.FNumber",
      "FMaterialFrom.FNumber",
      "FMaterialTo.FNumber",
      "FCustGroup.FNumber"
    ],
    "fieldCandidates": [
      {
        "label": "销售组织",
        "key": "FSALEORGNAME"
      },
      {
        "label": "订单编号",
        "key": "FBILLNO"
      },
      {
        "label": "单据类型",
        "key": "FBILLTYPE"
      },
      {
        "label": "订单日期",
        "key": "FDate"
      },
      {
        "label": "销售部门",
        "key": "FSALEDEPTID"
      },
      {
        "label": "销售组",
        "key": "FSALEGROUP"
      },
      {
        "label": "销售员",
        "key": "FSALES"
      },
      {
        "label": "客户编码",
        "key": "FCUSTID"
      },
      {
        "label": "客户名称",
        "key": "FCUSTOMERNAME"
      },
      {
        "label": "客户分组",
        "key": "FCustGroupName"
      },
      {
        "label": "地区",
        "key": "FPROVINCIAL"
      },
      {
        "label": "省份",
        "key": "FPROVINCE"
      },
      {
        "label": "城市",
        "key": "FCITY"
      },
      {
        "label": "收款条件",
        "key": "FRecCondition"
      },
      {
        "label": "订单行号",
        "key": "FORDERID"
      },
      {
        "label": "要货日期",
        "key": "FDELIVERYDAY"
      },
      {
        "label": "关联保证金",
        "key": "FAssociateMargin"
      },
      {
        "label": "关联退款保证金",
        "key": "FASSREFUNDMARGIN"
      },
      {
        "label": "物料编码",
        "key": "FMATERIALID"
      },
      {
        "label": "物料名称",
        "key": "FMATERIALNAME"
      },
      {
        "label": "客户物料编码",
        "key": "FMAPID"
      },
      {
        "label": "客户物料名称",
        "key": "FMAPNAME"
      },
      {
        "label": "规格型号",
        "key": "FSPECIFICATION"
      },
      {
        "label": "物料属性",
        "key": "FERPCLSID"
      },
      {
        "label": "物料分组",
        "key": "FMATERIALGROUPNAME"
      },
      {
        "label": "存货类别",
        "key": "FCATEGORYID"
      },
      {
        "label": "辅助属性",
        "key": "FAUXPROPID"
      },
      {
        "label": "销售单位",
        "key": "FUNIT"
      },
      {
        "label": "计价单位",
        "key": "FPRICEUNIT"
      },
      {
        "label": "是否赠品",
        "key": "FIsFree"
      },
      {
        "label": "币别",
        "key": "FCURRENCYID"
      },
      {
        "label": "本位币别",
        "key": "FLOCALCURRID"
      },
      {
        "label": "单价（销售单位）",
        "key": "FPrice"
      },
      {
        "label": "单价(销售单位)(本位币)",
        "key": "FPRICE_LC"
      },
      {
        "label": "单价（计价单位）",
        "key": "FCharge"
      },
      {
        "label": "单价(计价单位)(本位币)",
        "key": "FCHARGE_LC"
      },
      {
        "label": "订单数量",
        "key": "FORDERQTY"
      },
      {
        "label": "订单数量（计价单位）",
        "key": "FOrderChargeQty"
      },
      {
        "label": "订单金额",
        "key": "FORDERAMOUNT"
      },
      {
        "label": "订单金额(本位币)",
        "key": "FORDERAMOUNT_LC"
      },
      {
        "label": "发货通知单编号",
        "key": "FDELIBILLNO"
      },
      {
        "label": "发货通知数量",
        "key": "FDELIQTY"
      },
      {
        "label": "发货通知数量（计价单位）",
        "key": "FDELICHARGEQTY"
      },
      {
        "label": "发货通知金额",
        "key": "FDELIAMOUNT"
      },
      {
        "label": "发货通知金额(本位币)",
        "key": "FDELIAMOUNT_LC"
      },
      {
        "label": "出库单编号",
        "key": "FOUTBILLNO"
      },
      {
        "label": "出库日期",
        "key": "FOUTSTOCKDATE"
      },
      {
        "label": "已出库数量",
        "key": "FOUTQTY"
      },
      {
        "label": "已出库数量（计价单位）",
        "key": "FOUTCHARGEQTY"
      },
      {
        "label": "已出库金额",
        "key": "FOUTAMOUNT"
      },
      {
        "label": "已出库金额(本位币)",
        "key": "FOUTAMOUNT_LC"
      },
      {
        "label": "退货通知单编号",
        "key": "FRETURNPRDBILLNO"
      },
      {
        "label": "退货通知数量",
        "key": "FRETURNPQTY"
      },
      {
        "label": "退货通知数量（计价单位）",
        "key": "FRETURNPCHARGEQTY"
      },
      {
        "label": "退货通知金额",
        "key": "FRETURNPAMOUNT"
      },
      {
        "label": "退货通知金额(本位币)",
        "key": "FRETURNPAMOUNT_LC"
      },
      {
        "label": "销售退货单编号",
        "key": "FRETURNBILLNO"
      },
      {
        "label": "销售退货日期",
        "key": "FRETURNSTOCKDATE"
      },
      {
        "label": "销售退货数量",
        "key": "FRETURNQTY"
      },
      {
        "label": "销售退货数量（计价单位）",
        "key": "FRETURNCHARGEQTY"
      },
      {
        "label": "销售退货金额",
        "key": "FRETURNAMOUNT"
      },
      {
        "label": "销售退货金额(本位币)",
        "key": "FRETURNAMOUNT_LC"
      },
      {
        "label": "应收单号",
        "key": "FRECEIVEBILLNO"
      },
      {
        "label": "应收业务日期",
        "key": "FARDate"
      },
      {
        "label": "应收立账类型",
        "key": "FSetAccountType"
      },
      {
        "label": "应收数量",
        "key": "FRECQTY"
      },
      {
        "label": "应收数量（计价单位）",
        "key": "FRECEIVECHARGEQTY"
      },
      {
        "label": "应收金额",
        "key": "FRECAMOUNT"
      },
      {
        "label": "应收金额(本位币)",
        "key": "FRECAMOUNT_LC"
      },
      {
        "label": "调整金额",
        "key": "FWriteOffAmount"
      },
      {
        "label": "调整金额(本位币)",
        "key": "FWRITEOFFAMOUNT_LC"
      },
      {
        "label": "发票单据编号",
        "key": "FINVOECEBILLNO"
      },
      {
        "label": "发票日期",
        "key": "FINVOECEDATE"
      },
      {
        "label": "发票号码",
        "key": "FINVOECENO"
      },
      {
        "label": "开票数量",
        "key": "FINVOECEQTY"
      },
      {
        "label": "开票数量（计价单位）",
        "key": "FBILLCHARGEQTY"
      },
      {
        "label": "开票金额",
        "key": "FINVOECEAMOUNT"
      },
      {
        "label": "开票金额(本位币)",
        "key": "FINVOECEAMOUNT_LC"
      },
      {
        "label": "预收单号",
        "key": "FADVANCEBILLNO"
      },
      {
        "label": "预收单日期",
        "key": "FADVANCEBILLDATE"
      },
      {
        "label": "预收金额",
        "key": "FADVANCEAMOUNT"
      },
      {
        "label": "预收金额(本位币)",
        "key": "FADVANCEAMOUNT_LC"
      },
      {
        "label": "预收超收金额",
        "key": "FOVERRECAMOUNT"
      },
      {
        "label": "预收超收金额(本位币)",
        "key": "FOVERRECAMOUNT_LC"
      },
      {
        "label": "收款单号",
        "key": "FRECBILLNO"
      },
      {
        "label": "收款单日期",
        "key": "FRECBILLDATE"
      },
      {
        "label": "结算金额",
        "key": "FRECEIPTAMOUNT"
      },
      {
        "label": "结算金额(本位币)",
        "key": "FRECEIPTAMOUNT_LC"
      },
      {
        "label": "结算调整金额",
        "key": "FJSWRITEOFFAMOUNT"
      },
      {
        "label": "结算调整金额(本位币)",
        "key": "FJSWRITEOFFAMOUNT_LC"
      },
      {
        "label": "特殊冲销金额",
        "key": "FChargeOffAmount"
      },
      {
        "label": "特殊冲销金额冲销金额(本位币)",
        "key": "FCHARGEOFFAMOUNT_LC"
      },
      {
        "label": "收款核销金额",
        "key": "FRECSKAMOUNT"
      },
      {
        "label": "收款核销金额(本位币)",
        "key": "FRECSKAMOUNT_LC"
      },
      {
        "label": "整单关闭",
        "key": "FCLOSESTATUS"
      },
      {
        "label": "行业务关闭",
        "key": "FMRPCLOSESTATUS"
      },
      {
        "label": "行业务终止",
        "key": "FMrpTerminateStatus"
      },
      {
        "label": "行业务冻结",
        "key": "FMrpFreezeStatus"
      },
      {
        "label": "是否手工关闭",
        "key": "FMANUALCLOSE"
      },
      {
        "label": "是否手工行关闭",
        "key": "FMANUALROWCLOSE"
      },
      {
        "label": "是否期初订单",
        "key": "FISINIT"
      },
      {
        "label": "基本单位",
        "key": "FBaseUnitID"
      },
      {
        "label": "订单数量(基本单位)",
        "key": "FOrderBaseQty"
      },
      {
        "label": "单价(基本单位)",
        "key": "FBasePrice"
      },
      {
        "label": "单价(基本单位)(本位币)",
        "key": "FBASEPRICE_LC"
      },
      {
        "label": "发货通知数量(基本单位)",
        "key": "FDeliveryNoticeQty"
      },
      {
        "label": "已出库数量(基本单位)",
        "key": "FDeliveryQty"
      },
      {
        "label": "退货通知数量(基本单位)",
        "key": "FReturnNoticeQty"
      },
      {
        "label": "销售退货数量(基本单位)",
        "key": "FReturnBaseQty"
      },
      {
        "label": "应收数量(基本单位)",
        "key": "FReceiveQty"
      },
      {
        "label": "开票数量(基本单位)",
        "key": "FBaseInvoiceQty"
      },
      {
        "label": "预设基础资料1",
        "key": "FPRESETBASENAME1"
      },
      {
        "label": "预设基础资料2",
        "key": "FPRESETBASENAME2"
      },
      {
        "label": "预设辅助资料1",
        "key": "FPRESETASSISTANTNAME1"
      },
      {
        "label": "预设辅助资料2",
        "key": "FPRESETASSISTANTNAME2"
      },
      {
        "label": "订单预收未核销金额",
        "key": "FADVANCENOTMATCHAMOUNT"
      },
      {
        "label": "订单预收未核销金额(本位币)",
        "key": "FADVANCENOTMATCHAMOUNT_LC"
      },
      {
        "label": "订单收款金额字段",
        "key": "FALLMATCHAMOUNT"
      },
      {
        "label": "订单收款金额字段(本位币)",
        "key": "FALLMATCHAMOUNT_LC"
      },
      {
        "label": "订单数量",
        "key": "FORDERQTYTEMP"
      },
      {
        "label": "订单金额",
        "key": "FORDERAMOUNTTEMP"
      }
    ],
    "candidateFieldKeys": [
      "FSALEORGNAME",
      "FBILLNO",
      "FBILLTYPE",
      "FDate",
      "FSALEDEPTID",
      "FSALEGROUP",
      "FSALES",
      "FCUSTID",
      "FCUSTOMERNAME",
      "FCustGroupName",
      "FPROVINCIAL",
      "FPROVINCE",
      "FCITY",
      "FRecCondition",
      "FORDERID",
      "FDELIVERYDAY",
      "FAssociateMargin",
      "FASSREFUNDMARGIN",
      "FMATERIALID",
      "FMATERIALNAME",
      "FMAPID",
      "FMAPNAME",
      "FSPECIFICATION",
      "FERPCLSID",
      "FMATERIALGROUPNAME",
      "FCATEGORYID",
      "FAUXPROPID",
      "FUNIT",
      "FPRICEUNIT",
      "FIsFree",
      "FCURRENCYID",
      "FLOCALCURRID",
      "FPrice",
      "FPRICE_LC",
      "FCharge",
      "FCHARGE_LC",
      "FORDERQTY",
      "FOrderChargeQty",
      "FORDERAMOUNT",
      "FORDERAMOUNT_LC",
      "FDELIBILLNO",
      "FDELIQTY",
      "FDELICHARGEQTY",
      "FDELIAMOUNT",
      "FDELIAMOUNT_LC",
      "FOUTBILLNO",
      "FOUTSTOCKDATE",
      "FOUTQTY",
      "FOUTCHARGEQTY",
      "FOUTAMOUNT",
      "FOUTAMOUNT_LC",
      "FRETURNPRDBILLNO",
      "FRETURNPQTY",
      "FRETURNPCHARGEQTY",
      "FRETURNPAMOUNT",
      "FRETURNPAMOUNT_LC",
      "FRETURNBILLNO",
      "FRETURNSTOCKDATE",
      "FRETURNQTY",
      "FRETURNCHARGEQTY",
      "FRETURNAMOUNT",
      "FRETURNAMOUNT_LC",
      "FRECEIVEBILLNO",
      "FARDate",
      "FSetAccountType",
      "FRECQTY",
      "FRECEIVECHARGEQTY",
      "FRECAMOUNT",
      "FRECAMOUNT_LC",
      "FWriteOffAmount",
      "FWRITEOFFAMOUNT_LC",
      "FINVOECEBILLNO",
      "FINVOECEDATE",
      "FINVOECENO",
      "FINVOECEQTY",
      "FBILLCHARGEQTY",
      "FINVOECEAMOUNT",
      "FINVOECEAMOUNT_LC",
      "FADVANCEBILLNO",
      "FADVANCEBILLDATE",
      "FADVANCEAMOUNT",
      "FADVANCEAMOUNT_LC",
      "FOVERRECAMOUNT",
      "FOVERRECAMOUNT_LC",
      "FRECBILLNO",
      "FRECBILLDATE",
      "FRECEIPTAMOUNT",
      "FRECEIPTAMOUNT_LC",
      "FJSWRITEOFFAMOUNT",
      "FJSWRITEOFFAMOUNT_LC",
      "FChargeOffAmount",
      "FCHARGEOFFAMOUNT_LC",
      "FRECSKAMOUNT",
      "FRECSKAMOUNT_LC",
      "FCLOSESTATUS",
      "FMRPCLOSESTATUS",
      "FMrpTerminateStatus",
      "FMrpFreezeStatus",
      "FMANUALCLOSE",
      "FMANUALROWCLOSE",
      "FISINIT",
      "FBaseUnitID",
      "FOrderBaseQty",
      "FBasePrice",
      "FBASEPRICE_LC",
      "FDeliveryNoticeQty",
      "FDeliveryQty",
      "FReturnNoticeQty",
      "FReturnBaseQty",
      "FReceiveQty",
      "FBaseInvoiceQty",
      "FPRESETBASENAME1",
      "FPRESETBASENAME2",
      "FPRESETASSISTANTNAME1",
      "FPRESETASSISTANTNAME2",
      "FADVANCENOTMATCHAMOUNT",
      "FADVANCENOTMATCHAMOUNT_LC",
      "FALLMATCHAMOUNT",
      "FALLMATCHAMOUNT_LC",
      "FORDERQTYTEMP",
      "FORDERAMOUNTTEMP"
    ],
    "localRowsAvailable": true,
    "interpretationConstraints": [
      "字段说明、Model 与 FieldKeys 仅取自本项指定附件；不可与其他 FormId 报告互套。",
      "示例未验证目标账套、公开方法分类、筛选口径、单位/币别口径或行粒度。"
    ],
    "validation": {
      "source": "用户附件中的 GetSysReportData 示例；仅证明附件展示该方法调用，不构成公开API分类或目标账套验证。",
      "attachmentMethodDemonstrated": true,
      "publicApiClassificationVerified": false,
      "targetLedgerValidated": false,
      "schemeIdValidated": false,
      "fieldKeysSelected": false,
      "requiredEnumsValidated": false,
      "responseEnvelopeValidated": false,
      "rowGrainValidated": false,
      "liveCallAllowed": false
    },
    "blockers": [
      "附件示例请求的SchemeId与顶层FieldKeys留空；附件显示列清单已独立保留为输出候选，尚未选入请求或验证。",
      "附件标注的必填单选/枚举值域及目标账套校验方式未验证。",
      "响应 envelope、RowCount、Rows 的实际形态和行粒度未在目标账套验证。",
      "目标账套的报表字段、方法可用性、权限及组织范围均未验证。",
      "本候选中没有可展示的本地业务行；仅采购与销售明细由独立本地 demo fixture 提供。"
    ]
  },
  {
    "id": "sales-collect",
    "name": "销售执行汇总",
    "formId": "SAL_CollectReport",
    "method": "GetSysReportData",
    "status": "candidate_unverified_locked",
    "liveState": "unverified",
    "executionStatus": "locked",
    "methodEvidence": "attachment_example",
    "publicApiClassification": "unverified",
    "targetAccountValidation": "unverified",
    "schemeId": null,
    "selectedFieldKeys": null,
    "sourceAttachment": null,
    "requestedAttachment": null,
    "sourceAttachmentMatchesRequestedPath": null,
    "sourceReportedFormId": "SAL_CollectReport",
    "sourceMatchesRequestedFormId": true,
    "parameterFields": [
      {
        "label": "至",
        "key": "FSaleOTo",
        "requiredCandidate": false
      },
      {
        "label": "要货日期",
        "key": "FDelliveryDateFrom",
        "requiredCandidate": false
      },
      {
        "label": "至",
        "key": "FDelliveryDateTo",
        "requiredCandidate": false
      },
      {
        "label": "销售订单",
        "key": "FSaleOFrom",
        "requiredCandidate": false
      },
      {
        "label": "单据状态",
        "key": "FFormStatus",
        "requiredCandidate": true
      },
      {
        "label": "整单关闭状态",
        "key": "FFormCloseStatus",
        "requiredCandidate": true
      },
      {
        "label": "行业务关闭状态",
        "key": "FBusCloseStatus",
        "requiredCandidate": true
      },
      {
        "label": "发货",
        "key": "FShipment",
        "requiredCandidate": true
      },
      {
        "label": "出库",
        "key": "FOutStock",
        "requiredCandidate": true
      },
      {
        "label": "开票",
        "key": "FIncoice",
        "requiredCandidate": true
      },
      {
        "label": "收款",
        "key": "FReceipt",
        "requiredCandidate": true
      },
      {
        "label": "退库",
        "key": "FReturnStock",
        "requiredCandidate": true
      },
      {
        "label": "组织",
        "key": "FSaleOrgList",
        "requiredCandidate": true
      },
      {
        "label": "币别",
        "key": "FMoneyType",
        "requiredCandidate": false
      },
      {
        "label": "订单日期",
        "key": "FSoFromDate",
        "requiredCandidate": true
      },
      {
        "label": "至",
        "key": "FSoToDate",
        "requiredCandidate": true
      },
      {
        "label": "客户编码",
        "key": "FCustomerFrom",
        "requiredCandidate": false
      },
      {
        "label": "至",
        "key": "FCustomerTo",
        "requiredCandidate": false
      },
      {
        "label": "销售员编码",
        "key": "FSalesFrom",
        "requiredCandidate": false
      },
      {
        "label": "至",
        "key": "FSalesTo",
        "requiredCandidate": false
      },
      {
        "label": "物料编码",
        "key": "FMaterialFrom",
        "requiredCandidate": false
      },
      {
        "label": "至",
        "key": "FMaterialTo",
        "requiredCandidate": false
      },
      {
        "label": "查询时不合并展示订单的表头信息",
        "key": "FMergingSOHeader",
        "requiredCandidate": false
      },
      {
        "label": "包含未执行的销售订单",
        "key": "FIncludedUnfilledOrders",
        "requiredCandidate": false
      },
      {
        "label": "单价来源",
        "key": "FPriceFrom",
        "requiredCandidate": true
      },
      {
        "label": "按物料明细收款方式查询",
        "key": "FIsRecWithMat",
        "requiredCandidate": false
      },
      {
        "label": "客户分组",
        "key": "FCustGroup",
        "requiredCandidate": false
      },
      {
        "label": "统计套件",
        "key": "FSuite",
        "requiredCandidate": true
      },
      {
        "label": "集团客户",
        "key": "FIsGroup",
        "requiredCandidate": false
      },
      {
        "label": "包含赠品",
        "key": "FIncludedFree",
        "requiredCandidate": false
      },
      {
        "label": "未结算金额包括暂估应收",
        "key": "FNReceiptAmountIncludeZG",
        "requiredCandidate": false
      }
    ],
    "modelFieldKeys": [
      "FSaleOrgList",
      "FMoneyType",
      "FSoFromDate",
      "FSoToDate",
      "FCustomerFrom",
      "FCustomerTo",
      "FSalesFrom",
      "FSalesTo",
      "FMaterialFrom",
      "FMaterialTo",
      "FSaleOFrom",
      "FSaleOTo",
      "FDelliveryDateFrom",
      "FDelliveryDateTo",
      "FFormCloseStatus",
      "FPriceFrom",
      "FFormStatus",
      "FBusCloseStatus",
      "FShipment",
      "FOutStock",
      "FMergingSOHeader",
      "FIncoice",
      "FReceipt",
      "FCustGroup",
      "FReturnStock",
      "FIncludedUnfilledOrders",
      "FIsRecWithMat",
      "FSuite",
      "FIsGroup",
      "FIncludedFree",
      "FNReceiptAmountIncludeZG"
    ],
    "modelNestedFieldPaths": [
      "FMoneyType.FNumber",
      "FCustomerFrom.FNumber",
      "FCustomerTo.FNumber",
      "FSalesFrom.FNumber",
      "FSalesTo.FNumber",
      "FMaterialFrom.FNumber",
      "FMaterialTo.FNumber",
      "FCustGroup.FNumber"
    ],
    "fieldCandidates": [
      {
        "label": "订单编号",
        "key": "FBILLNO"
      },
      {
        "label": "单据类型",
        "key": "FBILLTYPE"
      },
      {
        "label": "订单日期",
        "key": "FDate"
      },
      {
        "label": "销售组织",
        "key": "FSALEORGNAME"
      },
      {
        "label": "销售部门",
        "key": "FSALEDEPTID"
      },
      {
        "label": "销售组",
        "key": "FSALEGROUP"
      },
      {
        "label": "销售员",
        "key": "FSALES"
      },
      {
        "label": "客户编码",
        "key": "FCUSTID"
      },
      {
        "label": "客户名称",
        "key": "FCUSTOMERNAME"
      },
      {
        "label": "客户分组",
        "key": "FCustGroupName"
      },
      {
        "label": "地区",
        "key": "FPROVINCIAL"
      },
      {
        "label": "省份",
        "key": "FPROVINCE"
      },
      {
        "label": "城市",
        "key": "FCITY"
      },
      {
        "label": "收款条件",
        "key": "FRecCondition"
      },
      {
        "label": "要货日期",
        "key": "FDELIVERYDAY"
      },
      {
        "label": "关联保证金",
        "key": "FAssociateMargin"
      },
      {
        "label": "关联退款保证金",
        "key": "FASSREFUNDMARGIN"
      },
      {
        "label": "订单行号",
        "key": "FSEQ"
      },
      {
        "label": "物料编码",
        "key": "FMATERIALID"
      },
      {
        "label": "物料名称",
        "key": "FMATERIALNAME"
      },
      {
        "label": "规格型号",
        "key": "FSPECIFICATION"
      },
      {
        "label": "物料属性",
        "key": "FERPCLSID"
      },
      {
        "label": "存货类别",
        "key": "FCATEGORYID"
      },
      {
        "label": "物料分组",
        "key": "FMATERIALGROUPNAME"
      },
      {
        "label": "辅助属性",
        "key": "FAUXPROPID"
      },
      {
        "label": "销售单位",
        "key": "FUNITID"
      },
      {
        "label": "计价单位",
        "key": "FPRICEUNITID"
      },
      {
        "label": "是否赠品",
        "key": "FIsFree"
      },
      {
        "label": "币别",
        "key": "FCURRENCYID"
      },
      {
        "label": "本位币别",
        "key": "FLOCALCURRID"
      },
      {
        "label": "单价（销售单位）",
        "key": "FPrice"
      },
      {
        "label": "单价(销售单位)(本位币)",
        "key": "FPRICE_LC"
      },
      {
        "label": "单价（计价单位）",
        "key": "FCHARGE"
      },
      {
        "label": "订单数量",
        "key": "FSOQTY"
      },
      {
        "label": "订单数量（计价单位）",
        "key": "FORDERCHARGEQTY"
      },
      {
        "label": "订单金额",
        "key": "FSOAMOUNT"
      },
      {
        "label": "订单金额(本位币)",
        "key": "FSOAMOUNT_LC"
      },
      {
        "label": "订单关联发票数量",
        "key": "FORDERINVOECEQTY"
      },
      {
        "label": "订单关联发票金额",
        "key": "FORDERNVOECEAMOUNT"
      },
      {
        "label": "订单关联发票金额（本位币）",
        "key": "FORDERNVOECEAMOUNT_LC"
      },
      {
        "label": "发货通知数量",
        "key": "FSQTY"
      },
      {
        "label": "发货通知数量（计价单位）",
        "key": "FDELICHARGEQty"
      },
      {
        "label": "发货通知金额",
        "key": "FSAMOUNT"
      },
      {
        "label": "发货通知金额(本位币)",
        "key": "FSAMOUNT_LC"
      },
      {
        "label": "未发货数量",
        "key": "FNODEQTY"
      },
      {
        "label": "未发货数量(计价单位)",
        "key": "FNODECHARGEQTY"
      },
      {
        "label": "未发货金额",
        "key": "FNODEAMOUNT"
      },
      {
        "label": "未发货金额(本位币)",
        "key": "FNODEAMOUNT_LC"
      },
      {
        "label": "已出库数量",
        "key": "FALREADYQTY"
      },
      {
        "label": "已出库数量（计价单位）",
        "key": "FHAVEOUTCHARGEQTY"
      },
      {
        "label": "已出库金额",
        "key": "FALREADYAMOUNT"
      },
      {
        "label": "已出库金额(本位币)",
        "key": "FALREADYAMOUNT_LC"
      },
      {
        "label": "未出库数量",
        "key": "FNOTQTY"
      },
      {
        "label": "未出库数量（计价单位）",
        "key": "FNOTOUTCHARGEQTY"
      },
      {
        "label": "未出库金额",
        "key": "FNOTAMOUNT"
      },
      {
        "label": "未出库金额(本位币)",
        "key": "FNOTAMOUNT_LC"
      },
      {
        "label": "退货通知数量",
        "key": "FRETURNPQTY"
      },
      {
        "label": "退货通知数量（计价单位）",
        "key": "FRETURNPCHARGEQTY"
      },
      {
        "label": "退货通知金额",
        "key": "FRETURNPAMOUNT"
      },
      {
        "label": "退货通知金额(本位币)",
        "key": "FRETURNPAMOUNT_LC"
      },
      {
        "label": "销售退货数量",
        "key": "FRETURNSQTY"
      },
      {
        "label": "销售退货数量（计价单位）",
        "key": "FRETURNCHARGEQTY"
      },
      {
        "label": "销售退货金额",
        "key": "FRETURNSAMOUNT"
      },
      {
        "label": "销售退货金额(本位币)",
        "key": "FRETURNSAMOUNT_LC"
      },
      {
        "label": "业务应收数量",
        "key": "FRECQTY"
      },
      {
        "label": "业务应收数量（计价单位）",
        "key": "FRECECHARGEQTY"
      },
      {
        "label": "未确认数量",
        "key": "FRECNQTY"
      },
      {
        "label": "未确认数量（计价单位）",
        "key": "FRECNCHARGEQTY"
      },
      {
        "label": "业务应收金额",
        "key": "FRECAMOUNT"
      },
      {
        "label": "业务应收金额(本位币)",
        "key": "FRECAMOUNT_LC"
      },
      {
        "label": "暂估应收金额",
        "key": "FRECZGAMOUNT"
      },
      {
        "label": "暂估应收金额(本位币)",
        "key": "FRECZGAMOUNT_LC"
      },
      {
        "label": "财务应收金额",
        "key": "FRECCWAMOUNT"
      },
      {
        "label": "财务应收金额(本位币)",
        "key": "FRECCWAMOUNT_LC"
      },
      {
        "label": "调整金额",
        "key": "FWriteOffAmount"
      },
      {
        "label": "应收调整金额(本位币)",
        "key": "FWRITEOFFAMOUNT_LC"
      },
      {
        "label": "未确认金额",
        "key": "FRECNAMOUNT"
      },
      {
        "label": "未确认金额(本位币)",
        "key": "FRECNAMOUNT_LC"
      },
      {
        "label": "开票数量",
        "key": "FINVOECEQTY"
      },
      {
        "label": "开票数量（计价单位）",
        "key": "FINVOECECHARGEQTY"
      },
      {
        "label": "开票金额",
        "key": "FNVOECEAMOUNT"
      },
      {
        "label": "开票金额(本位币)",
        "key": "FNVOECEAMOUNT_LC"
      },
      {
        "label": "未开票数量",
        "key": "FNINVOECEQTY"
      },
      {
        "label": "未开票数量（计价单位）",
        "key": "FNINVOECECHARGEQTY"
      },
      {
        "label": "订单未开票金额",
        "key": "FNNVOECEAMOUNT"
      },
      {
        "label": "订单未开票金额(本位币)",
        "key": "FNNVOECEAMOUNT_LC"
      },
      {
        "label": "应收未开票金额",
        "key": "FARNNVOECEAMOUNT"
      },
      {
        "label": "应收未开票金额(本位币)",
        "key": "FARNNVOECEAMOUNT_LC"
      },
      {
        "label": "预收金额",
        "key": "FADVANCEAMOUNT"
      },
      {
        "label": "预收金额(本位币)",
        "key": "FADVANCEAMOUNT_LC"
      },
      {
        "label": "预收超收金额",
        "key": "FOVERRECAMOUNT"
      },
      {
        "label": "预收超收金额(本位币)",
        "key": "FOVERRECAMOUNT_LC"
      },
      {
        "label": "结算金额",
        "key": "FRECEIPTAMOUNT"
      },
      {
        "label": "结算金额(本位币)",
        "key": "FRECEIPTAMOUNT_LC"
      },
      {
        "label": "结算调整金额",
        "key": "FJSWRITEOFFAMOUNT"
      },
      {
        "label": "结算调整金额(本位币)",
        "key": "FJSWRITEOFFAMOUNT_LC"
      },
      {
        "label": "收款核销金额",
        "key": "FRECSKAMOUNT"
      },
      {
        "label": "收款核销金额(本位币)",
        "key": "FRECSKAMOUNT_LC"
      },
      {
        "label": "未结算金额",
        "key": "FNRECEIPTAMOUNT"
      },
      {
        "label": "未结算金额(本位币)",
        "key": "FNRECEIPTAMOUNT_LC"
      },
      {
        "label": "整单关闭",
        "key": "FCLOSESTATUS"
      },
      {
        "label": "行业务关闭",
        "key": "FMRPCLOSESTATUS"
      },
      {
        "label": "行业务终止",
        "key": "FMrpTerminateStatus"
      },
      {
        "label": "行业务冻结",
        "key": "FMRPFREEZESTATUS"
      },
      {
        "label": "是否手工关闭",
        "key": "FMANUALCLOSE"
      },
      {
        "label": "是否手工行关闭",
        "key": "FMANUALROWCLOSE"
      },
      {
        "label": "是否期初订单",
        "key": "FISINIT"
      },
      {
        "label": "基本单位",
        "key": "FBaseUnitId"
      },
      {
        "label": "订单数量(基本单位)",
        "key": "FOrderBaseQty"
      },
      {
        "label": "单价(基本单位)",
        "key": "FBasePrice"
      },
      {
        "label": "发货通知单数量(基本单位)",
        "key": "FDeliveryNoticeQty"
      },
      {
        "label": "已出库数量(基本单位)",
        "key": "FDeliveryQty"
      },
      {
        "label": "未出库数量(基本单位)",
        "key": "FUnDeliveryQty"
      },
      {
        "label": "退货通知单数量(基本单位)",
        "key": "FReturnNoticeQty"
      },
      {
        "label": "销售退货数量(基本单位)",
        "key": "FReturnBaseQty"
      },
      {
        "label": "应收数量(基本单位)",
        "key": "FReceiveQty"
      },
      {
        "label": "未确定数量(基本单位)",
        "key": "FUnConfirmQty"
      },
      {
        "label": "开票数量(基本单位)",
        "key": "FBaseInvoiceQty"
      },
      {
        "label": "客户物料编码",
        "key": "FMAPID"
      },
      {
        "label": "客户物料名称",
        "key": "FMAPNAME"
      },
      {
        "label": "单价(计价单位)(本位币)",
        "key": "FCHARGE_LC"
      },
      {
        "label": "单价(基本单位)(本位币)",
        "key": "FBASEPRICE_LC"
      },
      {
        "label": "已结算比例(%)",
        "key": "FRECEIPTAMOUNTRATIO"
      },
      {
        "label": "未结算比例(%)",
        "key": "FNRECEIPTAMOUNTRATIO"
      },
      {
        "label": "预设基础资料1",
        "key": "FPRESETBASENAME1"
      },
      {
        "label": "预设基础资料2",
        "key": "FPRESETBASENAME2"
      },
      {
        "label": "预设辅助资料1",
        "key": "FPRESETASSISTANTNAME1"
      },
      {
        "label": "预设辅助资料2",
        "key": "FPRESETASSISTANTNAME2"
      },
      {
        "label": "暂估应收数量",
        "key": "FREZGCQTY"
      },
      {
        "label": "财务应收数量",
        "key": "FRECWCQTY"
      },
      {
        "label": "暂估应收数量（计价单位）",
        "key": "FRECECHARGEQTYZG"
      },
      {
        "label": "财务应收数量（计价单位）",
        "key": "FRECECHARGEQTYCW"
      },
      {
        "label": "订单预收未核销金额",
        "key": "FADVANCENOTMATCHAMOUNT"
      },
      {
        "label": "订单预收未核销金额(本位币)",
        "key": "FADVANCENOTMATCHAMOUNT_LC"
      },
      {
        "label": "订单收款金额",
        "key": "FALLMATCHAMOUNT"
      },
      {
        "label": "订单收款金额(本位币)",
        "key": "FALLMATCHAMOUNT_LC"
      },
      {
        "label": "订单未收款金额",
        "key": "FNRALLMATCHAMOUNT"
      },
      {
        "label": "订单未收款金额(本位币)",
        "key": "FNRALLMATCHAMOUNT_LC"
      }
    ],
    "candidateFieldKeys": [
      "FBILLNO",
      "FBILLTYPE",
      "FDate",
      "FSALEORGNAME",
      "FSALEDEPTID",
      "FSALEGROUP",
      "FSALES",
      "FCUSTID",
      "FCUSTOMERNAME",
      "FCustGroupName",
      "FPROVINCIAL",
      "FPROVINCE",
      "FCITY",
      "FRecCondition",
      "FDELIVERYDAY",
      "FAssociateMargin",
      "FASSREFUNDMARGIN",
      "FSEQ",
      "FMATERIALID",
      "FMATERIALNAME",
      "FSPECIFICATION",
      "FERPCLSID",
      "FCATEGORYID",
      "FMATERIALGROUPNAME",
      "FAUXPROPID",
      "FUNITID",
      "FPRICEUNITID",
      "FIsFree",
      "FCURRENCYID",
      "FLOCALCURRID",
      "FPrice",
      "FPRICE_LC",
      "FCHARGE",
      "FSOQTY",
      "FORDERCHARGEQTY",
      "FSOAMOUNT",
      "FSOAMOUNT_LC",
      "FORDERINVOECEQTY",
      "FORDERNVOECEAMOUNT",
      "FORDERNVOECEAMOUNT_LC",
      "FSQTY",
      "FDELICHARGEQty",
      "FSAMOUNT",
      "FSAMOUNT_LC",
      "FNODEQTY",
      "FNODECHARGEQTY",
      "FNODEAMOUNT",
      "FNODEAMOUNT_LC",
      "FALREADYQTY",
      "FHAVEOUTCHARGEQTY",
      "FALREADYAMOUNT",
      "FALREADYAMOUNT_LC",
      "FNOTQTY",
      "FNOTOUTCHARGEQTY",
      "FNOTAMOUNT",
      "FNOTAMOUNT_LC",
      "FRETURNPQTY",
      "FRETURNPCHARGEQTY",
      "FRETURNPAMOUNT",
      "FRETURNPAMOUNT_LC",
      "FRETURNSQTY",
      "FRETURNCHARGEQTY",
      "FRETURNSAMOUNT",
      "FRETURNSAMOUNT_LC",
      "FRECQTY",
      "FRECECHARGEQTY",
      "FRECNQTY",
      "FRECNCHARGEQTY",
      "FRECAMOUNT",
      "FRECAMOUNT_LC",
      "FRECZGAMOUNT",
      "FRECZGAMOUNT_LC",
      "FRECCWAMOUNT",
      "FRECCWAMOUNT_LC",
      "FWriteOffAmount",
      "FWRITEOFFAMOUNT_LC",
      "FRECNAMOUNT",
      "FRECNAMOUNT_LC",
      "FINVOECEQTY",
      "FINVOECECHARGEQTY",
      "FNVOECEAMOUNT",
      "FNVOECEAMOUNT_LC",
      "FNINVOECEQTY",
      "FNINVOECECHARGEQTY",
      "FNNVOECEAMOUNT",
      "FNNVOECEAMOUNT_LC",
      "FARNNVOECEAMOUNT",
      "FARNNVOECEAMOUNT_LC",
      "FADVANCEAMOUNT",
      "FADVANCEAMOUNT_LC",
      "FOVERRECAMOUNT",
      "FOVERRECAMOUNT_LC",
      "FRECEIPTAMOUNT",
      "FRECEIPTAMOUNT_LC",
      "FJSWRITEOFFAMOUNT",
      "FJSWRITEOFFAMOUNT_LC",
      "FRECSKAMOUNT",
      "FRECSKAMOUNT_LC",
      "FNRECEIPTAMOUNT",
      "FNRECEIPTAMOUNT_LC",
      "FCLOSESTATUS",
      "FMRPCLOSESTATUS",
      "FMrpTerminateStatus",
      "FMRPFREEZESTATUS",
      "FMANUALCLOSE",
      "FMANUALROWCLOSE",
      "FISINIT",
      "FBaseUnitId",
      "FOrderBaseQty",
      "FBasePrice",
      "FDeliveryNoticeQty",
      "FDeliveryQty",
      "FUnDeliveryQty",
      "FReturnNoticeQty",
      "FReturnBaseQty",
      "FReceiveQty",
      "FUnConfirmQty",
      "FBaseInvoiceQty",
      "FMAPID",
      "FMAPNAME",
      "FCHARGE_LC",
      "FBASEPRICE_LC",
      "FRECEIPTAMOUNTRATIO",
      "FNRECEIPTAMOUNTRATIO",
      "FPRESETBASENAME1",
      "FPRESETBASENAME2",
      "FPRESETASSISTANTNAME1",
      "FPRESETASSISTANTNAME2",
      "FREZGCQTY",
      "FRECWCQTY",
      "FRECECHARGEQTYZG",
      "FRECECHARGEQTYCW",
      "FADVANCENOTMATCHAMOUNT",
      "FADVANCENOTMATCHAMOUNT_LC",
      "FALLMATCHAMOUNT",
      "FALLMATCHAMOUNT_LC",
      "FNRALLMATCHAMOUNT",
      "FNRALLMATCHAMOUNT_LC"
    ],
    "localRowsAvailable": true,
    "interpretationConstraints": [
      "字段说明、Model 与 FieldKeys 仅取自本项指定附件；不可与其他 FormId 报告互套。",
      "示例未验证目标账套、公开方法分类、筛选口径、单位/币别口径或行粒度。"
    ],
    "validation": {
      "source": "用户附件中的 GetSysReportData 示例；仅证明附件展示该方法调用，不构成公开API分类或目标账套验证。",
      "attachmentMethodDemonstrated": true,
      "publicApiClassificationVerified": false,
      "targetLedgerValidated": false,
      "schemeIdValidated": false,
      "fieldKeysSelected": false,
      "requiredEnumsValidated": false,
      "responseEnvelopeValidated": false,
      "rowGrainValidated": false,
      "liveCallAllowed": false
    },
    "blockers": [
      "附件示例请求的SchemeId与顶层FieldKeys留空；附件显示列清单已独立保留为输出候选，尚未选入请求或验证。",
      "附件标注的必填单选/枚举值域及目标账套校验方式未验证。",
      "响应 envelope、RowCount、Rows 的实际形态和行粒度未在目标账套验证。",
      "目标账套的报表字段、方法可用性、权限及组织范围均未验证。",
      "本候选中没有可展示的本地业务行；仅采购与销售明细由独立本地 demo fixture 提供。"
    ]
  },
  {
    "id": "subcontract-detail",
    "name": "委外订单执行明细",
    "formId": "SUB_ROExecuteDetailRpt",
    "method": "GetSysReportData",
    "status": "candidate_unverified_locked",
    "liveState": "unverified",
    "executionStatus": "locked",
    "methodEvidence": "attachment_example",
    "publicApiClassification": "unverified",
    "targetAccountValidation": "unverified",
    "schemeId": null,
    "selectedFieldKeys": null,
    "sourceAttachment": null,
    "requestedAttachment": null,
    "sourceAttachmentMatchesRequestedPath": null,
    "sourceReportedFormId": "SUB_ROExecuteDetailRpt",
    "sourceMatchesRequestedFormId": true,
    "parameterFields": [
      {
        "label": "至：",
        "key": "FEndRONumber",
        "requiredCandidate": false
      },
      {
        "label": "下达日期",
        "key": "FBeginConveyDate",
        "requiredCandidate": true
      },
      {
        "label": "产品编码",
        "key": "FBeginMaterialId",
        "requiredCandidate": false
      },
      {
        "label": "委外订单",
        "key": "FBeginRONumber",
        "requiredCandidate": false
      },
      {
        "label": "至：",
        "key": "FEndPlanFinishDate",
        "requiredCandidate": true
      },
      {
        "label": "计划完工日期",
        "key": "FBeginPlanFinishDate",
        "requiredCandidate": true
      },
      {
        "label": "单据类型",
        "key": "FROBillType",
        "requiredCandidate": true
      },
      {
        "label": "至：",
        "key": "FEndMaterialId",
        "requiredCandidate": false
      },
      {
        "label": "至：",
        "key": "FEndPlanStartDate",
        "requiredCandidate": true
      },
      {
        "label": "计划开工日期",
        "key": "FBeginPlanStartDate",
        "requiredCandidate": true
      },
      {
        "label": "至：",
        "key": "FEndConveyDate",
        "requiredCandidate": true
      },
      {
        "label": "业务状态",
        "key": "FStatus",
        "requiredCandidate": true
      },
      {
        "label": "采购组织",
        "key": "FPurOrgId",
        "requiredCandidate": false
      },
      {
        "label": "领料计算",
        "key": "FCtrlItem",
        "requiredCandidate": true
      },
      {
        "label": "委外组织",
        "key": "FSubOrgId",
        "requiredCandidate": false
      },
      {
        "label": "供应商",
        "key": "FSuppliers",
        "requiredCandidate": false
      },
      {
        "label": "参与查询",
        "key": "FConveyDateInvolve",
        "requiredCandidate": false
      },
      {
        "label": "参与查询",
        "key": "FStartDateInvolve",
        "requiredCandidate": false
      },
      {
        "label": "参与查询",
        "key": "FFinishDateInvolve",
        "requiredCandidate": false
      },
      {
        "label": "产品编码",
        "key": "FMulMaterial",
        "requiredCandidate": false
      }
    ],
    "modelFieldKeys": [
      "FEndRONumber",
      "FBeginRONumber",
      "FCtrlItem",
      "FPurOrgId",
      "FStatus",
      "FEndConveyDate",
      "FEndPlanStartDate",
      "FEndMaterialId",
      "FBeginPlanStartDate",
      "FBeginPlanFinishDate",
      "FEndPlanFinishDate",
      "FBeginMaterialId",
      "FBeginConveyDate",
      "FROBillType",
      "FSubOrgId",
      "FSuppliers",
      "FConveyDateInvolve",
      "FStartDateInvolve",
      "FFinishDateInvolve",
      "FMulMaterial"
    ],
    "modelNestedFieldPaths": [
      "FPurOrgId.FNumber",
      "FEndMaterialId.FNumber",
      "FBeginMaterialId.FNumber",
      "FSuppliers[].FNumber",
      "FMulMaterial[].FNumber"
    ],
    "fieldCandidates": [
      {
        "label": "供应商",
        "key": "FSUPPLIERID"
      },
      {
        "label": "单据类型",
        "key": "FROBILLTYPEID"
      },
      {
        "label": "委外订单编号",
        "key": "FROBILLNO"
      },
      {
        "label": "委外订单行号",
        "key": "FROENTRYSEQ"
      },
      {
        "label": "产品编码",
        "key": "FMATERIALID"
      },
      {
        "label": "产品名称",
        "key": "FMATERIALNAME"
      },
      {
        "label": "规格型号",
        "key": "FMATERIALMODEL"
      },
      {
        "label": "产品类型",
        "key": "FPRODUCTTYPENAME"
      },
      {
        "label": "辅助属性",
        "key": "FAUXPROP"
      },
      {
        "label": "BOM版本",
        "key": "FBOMID"
      },
      {
        "label": "计划跟踪号",
        "key": "FMTONO"
      },
      {
        "label": "计划开工日期",
        "key": "FPLANSTARTDATE"
      },
      {
        "label": "计划完工日期",
        "key": "FPLANFINISHDATE"
      },
      {
        "label": "需求来源",
        "key": "FREQSRC"
      },
      {
        "label": "需求单据",
        "key": "FSaleOrderNo"
      },
      {
        "label": "需求单据行号",
        "key": "FSALEORDERENTRYSEQ"
      },
      {
        "label": "下达日期",
        "key": "FCONVEYDATE"
      },
      {
        "label": "完工日期",
        "key": "FFINISHDATE"
      },
      {
        "label": "委外单位",
        "key": "FPRDUNITID"
      },
      {
        "label": "计划生产数量",
        "key": "FPLANQTY"
      },
      {
        "label": "采购执行数量",
        "key": "FPURQTY"
      },
      {
        "label": "入库数量",
        "key": "FSTOCKINQTY"
      },
      {
        "label": "未入库数量",
        "key": "FNOSTOCKINQTY"
      },
      {
        "label": "计划完成百分比",
        "key": "FPLANFINISHPERCENT"
      },
      {
        "label": "入库货主",
        "key": "FInStockOwnerName"
      },
      {
        "label": "已领套数",
        "key": "FPICKEDQTY"
      },
      {
        "label": "业务状态",
        "key": "FSTATUSNAME"
      },
      {
        "label": "结案类型",
        "key": "FCLOSETYPENAME"
      }
    ],
    "candidateFieldKeys": [
      "FSUPPLIERID",
      "FROBILLTYPEID",
      "FROBILLNO",
      "FROENTRYSEQ",
      "FMATERIALID",
      "FMATERIALNAME",
      "FMATERIALMODEL",
      "FPRODUCTTYPENAME",
      "FAUXPROP",
      "FBOMID",
      "FMTONO",
      "FPLANSTARTDATE",
      "FPLANFINISHDATE",
      "FREQSRC",
      "FSaleOrderNo",
      "FSALEORDERENTRYSEQ",
      "FCONVEYDATE",
      "FFINISHDATE",
      "FPRDUNITID",
      "FPLANQTY",
      "FPURQTY",
      "FSTOCKINQTY",
      "FNOSTOCKINQTY",
      "FPLANFINISHPERCENT",
      "FInStockOwnerName",
      "FPICKEDQTY",
      "FSTATUSNAME",
      "FCLOSETYPENAME"
    ],
    "localRowsAvailable": false,
    "interpretationConstraints": [
      "字段说明、Model 与 FieldKeys 仅取自本项指定附件；不可与其他 FormId 报告互套。",
      "示例未验证目标账套、公开方法分类、筛选口径、单位/币别口径或行粒度。"
    ],
    "validation": {
      "source": "用户附件中的 GetSysReportData 示例；仅证明附件展示该方法调用，不构成公开API分类或目标账套验证。",
      "attachmentMethodDemonstrated": true,
      "publicApiClassificationVerified": false,
      "targetLedgerValidated": false,
      "schemeIdValidated": false,
      "fieldKeysSelected": false,
      "requiredEnumsValidated": false,
      "responseEnvelopeValidated": false,
      "rowGrainValidated": false,
      "liveCallAllowed": false
    },
    "blockers": [
      "附件示例请求的SchemeId与顶层FieldKeys留空；附件显示列清单已独立保留为输出候选，尚未选入请求或验证。",
      "附件标注的必填单选/枚举值域及目标账套校验方式未验证。",
      "响应 envelope、RowCount、Rows 的实际形态和行粒度未在目标账套验证。",
      "目标账套的报表字段、方法可用性、权限及组织范围均未验证。",
      "本候选中没有可展示的本地业务行；仅采购与销售明细由独立本地 demo fixture 提供。"
    ]
  },
  {
    "id": "subcontract-summary",
    "name": "委外订单执行汇总",
    "formId": "SUB_ROExecuteSummaryRpt",
    "method": "GetSysReportData",
    "status": "candidate_unverified_locked",
    "liveState": "unverified",
    "executionStatus": "locked",
    "methodEvidence": "attachment_example",
    "publicApiClassification": "unverified",
    "targetAccountValidation": "unverified",
    "schemeId": null,
    "selectedFieldKeys": null,
    "sourceAttachment": null,
    "requestedAttachment": null,
    "sourceAttachmentMatchesRequestedPath": null,
    "sourceReportedFormId": "SUB_ROExecuteSummaryRpt",
    "sourceMatchesRequestedFormId": true,
    "parameterFields": [
      {
        "label": "至：",
        "key": "FEndRONumber",
        "requiredCandidate": false
      },
      {
        "label": "产品编码",
        "key": "FBeginMaterialId",
        "requiredCandidate": false
      },
      {
        "label": "委外订单",
        "key": "FBeginRONumber",
        "requiredCandidate": false
      },
      {
        "label": "至：",
        "key": "FEndPlanFinishDate",
        "requiredCandidate": true
      },
      {
        "label": "计划完工日期",
        "key": "FBeginPlanFinishDate",
        "requiredCandidate": true
      },
      {
        "label": "单据类型",
        "key": "FROBillType",
        "requiredCandidate": true
      },
      {
        "label": "至：",
        "key": "FEndMaterialId",
        "requiredCandidate": false
      },
      {
        "label": "至：",
        "key": "FEndPlanStartDate",
        "requiredCandidate": true
      },
      {
        "label": "计划开工日期",
        "key": "FBeginPlanStartDate",
        "requiredCandidate": true
      },
      {
        "label": "业务状态",
        "key": "FStatus",
        "requiredCandidate": true
      },
      {
        "label": "采购组织",
        "key": "FPurOrgId",
        "requiredCandidate": false
      },
      {
        "label": "单据状态",
        "key": "FRODocumentStatus",
        "requiredCandidate": true
      },
      {
        "label": "汇总依据",
        "key": "FSummaryBasis",
        "requiredCandidate": true
      },
      {
        "label": "领料计算",
        "key": "FCtrlItem",
        "requiredCandidate": true
      },
      {
        "label": "委外组织",
        "key": "FSubOrgId",
        "requiredCandidate": false
      },
      {
        "label": "供应商",
        "key": "FSuppliers",
        "requiredCandidate": false
      },
      {
        "label": "结案类型",
        "key": "FCloseType",
        "requiredCandidate": false
      },
      {
        "label": "参与查询",
        "key": "FStartDateInvolve",
        "requiredCandidate": false
      },
      {
        "label": "参与查询",
        "key": "FFinishDateInvolve",
        "requiredCandidate": false
      },
      {
        "label": "产品编码",
        "key": "FMulMaterial",
        "requiredCandidate": false
      }
    ],
    "modelFieldKeys": [
      "FEndRONumber",
      "FBeginRONumber",
      "FCtrlItem",
      "FSummaryBasis",
      "FRODocumentStatus",
      "FPurOrgId",
      "FBeginPlanStartDate",
      "FEndPlanStartDate",
      "FStatus",
      "FROBillType",
      "FBeginPlanFinishDate",
      "FEndPlanFinishDate",
      "FBeginMaterialId",
      "FEndMaterialId",
      "FSubOrgId",
      "FSuppliers",
      "FCloseType",
      "FStartDateInvolve",
      "FFinishDateInvolve",
      "FMulMaterial"
    ],
    "modelNestedFieldPaths": [
      "FPurOrgId.FNumber",
      "FBeginMaterialId.FNumber",
      "FEndMaterialId.FNumber",
      "FSuppliers[].FNumber",
      "FMulMaterial[].FNumber"
    ],
    "fieldCandidates": [
      {
        "label": "供应商",
        "key": "FSUPPLIERID"
      },
      {
        "label": "产品编码",
        "key": "FMATERIALID"
      },
      {
        "label": "产品名称",
        "key": "FMATERIALNAME"
      },
      {
        "label": "规格型号",
        "key": "FMATERIALMODEL"
      },
      {
        "label": "产品类型",
        "key": "FPRODUCTTYPENAME"
      },
      {
        "label": "辅助属性",
        "key": "FAUXPROP"
      },
      {
        "label": "BOM版本",
        "key": "FBOMID"
      },
      {
        "label": "计划跟踪号",
        "key": "FMTONO"
      },
      {
        "label": "委外单位",
        "key": "FPRDUNITID"
      },
      {
        "label": "计划生产数量",
        "key": "FPLANQTY"
      },
      {
        "label": "采购执行数量",
        "key": "FPURQTY"
      },
      {
        "label": "入库数量",
        "key": "FSTOCKINQTY"
      },
      {
        "label": "未入库数量",
        "key": "FNOSTOCKINQTY"
      },
      {
        "label": "已领套数",
        "key": "FPICKEDQTY"
      }
    ],
    "candidateFieldKeys": [
      "FSUPPLIERID",
      "FMATERIALID",
      "FMATERIALNAME",
      "FMATERIALMODEL",
      "FPRODUCTTYPENAME",
      "FAUXPROP",
      "FBOMID",
      "FMTONO",
      "FPRDUNITID",
      "FPLANQTY",
      "FPURQTY",
      "FSTOCKINQTY",
      "FNOSTOCKINQTY",
      "FPICKEDQTY"
    ],
    "localRowsAvailable": false,
    "interpretationConstraints": [
      "字段说明、Model 与 FieldKeys 仅取自本项指定附件；不可与其他 FormId 报告互套。",
      "示例未验证目标账套、公开方法分类、筛选口径、单位/币别口径或行粒度。"
    ],
    "validation": {
      "source": "用户附件中的 GetSysReportData 示例；仅证明附件展示该方法调用，不构成公开API分类或目标账套验证。",
      "attachmentMethodDemonstrated": true,
      "publicApiClassificationVerified": false,
      "targetLedgerValidated": false,
      "schemeIdValidated": false,
      "fieldKeysSelected": false,
      "requiredEnumsValidated": false,
      "responseEnvelopeValidated": false,
      "rowGrainValidated": false,
      "liveCallAllowed": false
    },
    "blockers": [
      "附件示例请求的SchemeId与顶层FieldKeys留空；附件显示列清单已独立保留为输出候选，尚未选入请求或验证。",
      "附件标注的必填单选/枚举值域及目标账套校验方式未验证。",
      "响应 envelope、RowCount、Rows 的实际形态和行粒度未在目标账套验证。",
      "目标账套的报表字段、方法可用性、权限及组织范围均未验证。",
      "本候选中没有可展示的本地业务行；仅采购与销售明细由独立本地 demo fixture 提供。"
    ]
  },
  {
    "id": "ar-aging",
    "name": "应收账龄",
    "formId": "AR_AgingAnalysis",
    "method": "GetSysReportData",
    "status": "candidate_unverified_locked",
    "liveState": "unverified",
    "executionStatus": "locked",
    "methodEvidence": "attachment_example",
    "publicApiClassification": "unverified",
    "targetAccountValidation": "unverified",
    "schemeId": null,
    "selectedFieldKeys": null,
    "sourceAttachment": null,
    "requestedAttachment": null,
    "sourceAttachmentMatchesRequestedPath": null,
    "sourceReportedFormId": "AR_AgingAnalysis",
    "sourceMatchesRequestedFormId": true,
    "parameterFields": [
      {
        "label": "日期",
        "key": "FByDate",
        "requiredCandidate": true
      },
      {
        "label": "往来单位类型",
        "key": "FCONTACTUNITTYPE",
        "requiredCandidate": false
      },
      {
        "label": "往来单位",
        "key": "FContactUnitFrom",
        "requiredCandidate": false
      },
      {
        "label": "业务日期",
        "key": "FRadioBusinessDate",
        "requiredCandidate": false
      },
      {
        "label": "到期日",
        "key": "FRadioEndDate",
        "requiredCandidate": false
      },
      {
        "label": "包括未审核单据",
        "key": "FUnAudit",
        "requiredCandidate": false
      },
      {
        "label": "按单据显示",
        "key": "FByBill",
        "requiredCandidate": false
      },
      {
        "label": "内部结算",
        "key": "FInSettle",
        "requiredCandidate": false
      },
      {
        "label": "会计核算体系",
        "key": "FAccountSystem",
        "requiredCandidate": false
      },
      {
        "label": "外部结算",
        "key": "FOutSettle",
        "requiredCandidate": false
      },
      {
        "label": "单选按钮组",
        "key": "FAgingCalStd",
        "requiredCandidate": false
      },
      {
        "label": "来自过滤条件",
        "key": "FIsFromFilter",
        "requiredCandidate": false
      },
      {
        "label": "往来单位",
        "key": "FContactUnitTo",
        "requiredCandidate": false
      },
      {
        "label": "结算组织",
        "key": "FSettleOrgLst",
        "requiredCandidate": true
      },
      {
        "label": "隶属方案",
        "key": "FAffiliation",
        "requiredCandidate": false
      },
      {
        "label": "包含暂估应收",
        "key": "FIncludePayEvaluate_New",
        "requiredCandidate": false
      },
      {
        "label": "仅显示暂估应收",
        "key": "FOnlyShowPayEvaluate_New",
        "requiredCandidate": false
      },
      {
        "label": "币别",
        "key": "FCurrencyFrom",
        "requiredCandidate": false
      },
      {
        "label": "截止日期的单据余额",
        "key": "FToEndDate",
        "requiredCandidate": false
      },
      {
        "label": "集团客户",
        "key": "FGroupCustomer",
        "requiredCandidate": false
      },
      {
        "label": "显示本位币",
        "key": "FShowLocal",
        "requiredCandidate": false
      },
      {
        "label": "不包含预收款",
        "key": "FNoPreReceive",
        "requiredCandidate": false
      },
      {
        "label": "仅显示预收款",
        "key": "FOnlyShowPreReceive",
        "requiredCandidate": false
      },
      {
        "label": "多选",
        "key": "FMULCONTACT",
        "requiredCandidate": false
      },
      {
        "label": "往来单位",
        "key": "FCONTACTUNITMUL",
        "requiredCandidate": false
      },
      {
        "label": "显示综合本位币小计",
        "key": "FShowSumLocal",
        "requiredCandidate": false
      },
      {
        "label": "预设基础资料字段1",
        "key": "FPRESETBASE1",
        "requiredCandidate": false
      },
      {
        "label": "预设基础资料字段2",
        "key": "FPRESETBASE2",
        "requiredCandidate": false
      },
      {
        "label": "不包含B2C单据",
        "key": "FEXCLUDEB2CAR",
        "requiredCandidate": false
      },
      {
        "label": "本位币余额按期末汇率重算",
        "key": "FReSetAllocateExc",
        "requiredCandidate": false
      },
      {
        "label": "调汇汇率类型",
        "key": "FExChangeRateType",
        "requiredCandidate": true
      },
      {
        "label": "账龄分组设置",
        "key": "FSection",
        "requiredCandidate": false
      },
      {
        "label": "天数",
        "key": "FDays",
        "requiredCandidate": false
      }
    ],
    "modelFieldKeys": [
      "FAffiliation",
      "FCONTACTUNITTYPE",
      "FContactUnitFrom",
      "FContactUnitTo",
      "FByDate",
      "FRadioBusinessDate",
      "FRadioEndDate",
      "FUnAudit",
      "FByBill",
      "FInSettle",
      "FAccountSystem",
      "FOutSettle",
      "FIsFromFilter",
      "FSettleOrgLst",
      "FIncludePayEvaluate_New",
      "FOnlyShowPayEvaluate_New",
      "FGroupCustomer",
      "FShowLocal",
      "FShowSumLocal",
      "FCurrencyFrom",
      "FToEndDate",
      "FNoPreReceive",
      "FOnlyShowPreReceive",
      "FCONTACTUNITMUL",
      "FMULCONTACT",
      "FPRESETBASE1",
      "FPRESETBASE2",
      "FEXCLUDEB2CAR",
      "FReSetAllocateExc",
      "FExChangeRateType",
      "FAgingCalStd",
      "FEntAgingGrpSetting"
    ],
    "modelNestedFieldPaths": [
      "FAffiliation.FNAME",
      "FContactUnitFrom.FNumber",
      "FContactUnitTo.FNumber",
      "FAccountSystem.FNumber",
      "FExChangeRateType.FNUMBER",
      "FEntAgingGrpSetting[].FSection",
      "FEntAgingGrpSetting[].FDays"
    ],
    "fieldCandidates": [
      {
        "label": "往来单位编码",
        "key": "FContactUnitNumber"
      },
      {
        "label": "往来单位",
        "key": "FCONTACTUNIT"
      },
      {
        "label": "币别",
        "key": "FCurrencyName"
      },
      {
        "label": "收付组织",
        "key": "FPAYORGNAME"
      },
      {
        "label": "结算组织",
        "key": "FSettleOrgName"
      },
      {
        "label": "销售组织",
        "key": "FSaleOrgName"
      },
      {
        "label": "销售部门",
        "key": "FSaleDeptName"
      },
      {
        "label": "销售组",
        "key": "FSaleGroupName"
      },
      {
        "label": "销售员",
        "key": "FSalerName"
      },
      {
        "label": "单据类型",
        "key": "FBillTypeName"
      },
      {
        "label": "单据编号",
        "key": "FBillNo"
      },
      {
        "label": "业务日期",
        "key": "FDate"
      },
      {
        "label": "到期日",
        "key": "FEndDate"
      },
      {
        "label": "地区",
        "key": "FPROVINCIAL"
      },
      {
        "label": "尚未收款金额(原币)",
        "key": "FBalanceAmtFor"
      },
      {
        "label": "币别(本位币)",
        "key": "FMasterCurrencyName"
      },
      {
        "label": "尚未收款金额(本位币)",
        "key": "FBalanceAmt"
      },
      {
        "label": "备注",
        "key": "FREMARK"
      },
      {
        "label": "立账类型",
        "key": "FSetAccountType"
      },
      {
        "label": "物料编码",
        "key": "FMATERIALNUMBER"
      },
      {
        "label": "物料名称",
        "key": "FMATERIALNAME"
      },
      {
        "label": "订单编号",
        "key": "FORDERNUMBER"
      },
      {
        "label": "客户分组",
        "key": "FCUSTGROUPNAME"
      },
      {
        "label": "收款条件",
        "key": "FPayConditon"
      },
      {
        "label": "是否转销生成",
        "key": "FISWRITEOFF"
      }
    ],
    "candidateFieldKeys": [
      "FContactUnitNumber",
      "FCONTACTUNIT",
      "FCurrencyName",
      "FPAYORGNAME",
      "FSettleOrgName",
      "FSaleOrgName",
      "FSaleDeptName",
      "FSaleGroupName",
      "FSalerName",
      "FBillTypeName",
      "FBillNo",
      "FDate",
      "FEndDate",
      "FPROVINCIAL",
      "FBalanceAmtFor",
      "FMasterCurrencyName",
      "FBalanceAmt",
      "FREMARK",
      "FSetAccountType",
      "FMATERIALNUMBER",
      "FMATERIALNAME",
      "FORDERNUMBER",
      "FCUSTGROUPNAME",
      "FPayConditon",
      "FISWRITEOFF"
    ],
    "localRowsAvailable": false,
    "interpretationConstraints": [
      "字段说明、Model 与 FieldKeys 仅取自本项指定附件；不可与其他 FormId 报告互套。",
      "示例未验证目标账套、公开方法分类、筛选口径、单位/币别口径或行粒度。"
    ],
    "validation": {
      "source": "用户附件中的 GetSysReportData 示例；仅证明附件展示该方法调用，不构成公开API分类或目标账套验证。",
      "attachmentMethodDemonstrated": true,
      "publicApiClassificationVerified": false,
      "targetLedgerValidated": false,
      "schemeIdValidated": false,
      "fieldKeysSelected": false,
      "requiredEnumsValidated": false,
      "responseEnvelopeValidated": false,
      "rowGrainValidated": false,
      "liveCallAllowed": false
    },
    "blockers": [
      "附件示例请求的SchemeId与顶层FieldKeys留空；附件显示列清单已独立保留为输出候选，尚未选入请求或验证。",
      "附件标注的必填单选/枚举值域及目标账套校验方式未验证。",
      "响应 envelope、RowCount、Rows 的实际形态和行粒度未在目标账套验证。",
      "目标账套的报表字段、方法可用性、权限及组织范围均未验证。",
      "本候选中没有可展示的本地业务行；仅采购与销售明细由独立本地 demo fixture 提供。"
    ]
  },
  {
    "id": "ar-detail",
    "name": "应收明细",
    "formId": "AR_PAYDETAILREPORT",
    "method": "GetSysReportData",
    "status": "candidate_unverified_locked",
    "liveState": "unverified",
    "executionStatus": "locked",
    "methodEvidence": "attachment_example",
    "publicApiClassification": "unverified",
    "targetAccountValidation": "unverified",
    "schemeId": null,
    "selectedFieldKeys": null,
    "sourceAttachment": null,
    "requestedAttachment": null,
    "sourceAttachmentMatchesRequestedPath": null,
    "sourceReportedFormId": "AR_PAYDETAILREPORT",
    "sourceMatchesRequestedFormId": true,
    "parameterFields": [
      {
        "label": "往来单位类型",
        "key": "FCONTACTUNITTYPE",
        "requiredCandidate": false
      },
      {
        "label": "往来单位",
        "key": "FCONTACTUNITFrom",
        "requiredCandidate": false
      },
      {
        "label": "开始日期",
        "key": "FBeginDate",
        "requiredCandidate": false
      },
      {
        "label": "结束日期",
        "key": "FEndDate",
        "requiredCandidate": false
      },
      {
        "label": "包括未审核单据",
        "key": "FNOAUDIT",
        "requiredCandidate": false
      },
      {
        "label": "无发生额不显示",
        "key": "FNoShowForNoOccur",
        "requiredCandidate": false
      },
      {
        "label": "余额为零不显示",
        "key": "FNoShowForNoLeft",
        "requiredCandidate": false
      },
      {
        "label": "无发生额且余额为零不显示",
        "key": "FNoShowForBoth",
        "requiredCandidate": false
      },
      {
        "label": "外部结算",
        "key": "FOutSettle",
        "requiredCandidate": false
      },
      {
        "label": "内部结算",
        "key": "FInSettle",
        "requiredCandidate": false
      },
      {
        "label": "会计核算体系",
        "key": "FAccountSystem",
        "requiredCandidate": false
      },
      {
        "label": "往来单位至",
        "key": "FCONTACTUNITTo",
        "requiredCandidate": false
      },
      {
        "label": "结算组织",
        "key": "FSettleOrgLst",
        "requiredCandidate": true
      },
      {
        "label": "隶属方案",
        "key": "FAffiliation",
        "requiredCandidate": false
      },
      {
        "label": "币别",
        "key": "FCurrencyFrom",
        "requiredCandidate": false
      },
      {
        "label": "默认会计日历",
        "key": "FDEFAULTACCTCALENDARID",
        "requiredCandidate": false
      },
      {
        "label": "仅显示已出库未应收",
        "key": "FOnlyShowPayEvaluate",
        "requiredCandidate": false
      },
      {
        "label": "包含已出库未应收",
        "key": "FIncludePayEvaluate",
        "requiredCandidate": false
      },
      {
        "label": "会计年度",
        "key": "FSTARTYEAR",
        "requiredCandidate": false
      },
      {
        "label": "会计期间",
        "key": "FSTARTPERIOD",
        "requiredCandidate": false
      },
      {
        "label": "单选按钮组",
        "key": "FDateRadioGrp",
        "requiredCandidate": false
      },
      {
        "label": "按期间查询",
        "key": "FUSEPERIOD",
        "requiredCandidate": false
      },
      {
        "label": "按日业务期查询",
        "key": "FUSEDATE",
        "requiredCandidate": false
      },
      {
        "label": "包含暂估应收",
        "key": "FIncludePayEvaluate_New",
        "requiredCandidate": false
      },
      {
        "label": "仅显示暂估应收",
        "key": "FOnlyShowPayEvaluate_New",
        "requiredCandidate": false
      },
      {
        "label": "至",
        "key": "FENDYEAR",
        "requiredCandidate": false
      },
      {
        "label": "至",
        "key": "FENDPERIOD",
        "requiredCandidate": false
      },
      {
        "label": "按物料明细显示",
        "key": "FShowByMaterial",
        "requiredCandidate": false
      },
      {
        "label": "集团客户",
        "key": "FGroupCustomer",
        "requiredCandidate": false
      },
      {
        "label": "显示综合本位币小计",
        "key": "FShowSumLocal",
        "requiredCandidate": false
      },
      {
        "label": "显示本位币",
        "key": "FShowLocal",
        "requiredCandidate": false
      },
      {
        "label": "不包含预收款",
        "key": "FNoPreReceive",
        "requiredCandidate": false
      },
      {
        "label": "仅显示预收款",
        "key": "FOnlyShowPreReceive",
        "requiredCandidate": false
      },
      {
        "label": "多选",
        "key": "FMULCONTACT",
        "requiredCandidate": false
      },
      {
        "label": "往来单位",
        "key": "FCONTACTUNITMUL",
        "requiredCandidate": false
      },
      {
        "label": "包含金额为零单据",
        "key": "FShowZeroAmountBill",
        "requiredCandidate": false
      },
      {
        "label": "当期暂估冲回不显示",
        "key": "FRedHookNotDisp",
        "requiredCandidate": false
      },
      {
        "label": "预设基础资料1",
        "key": "FPRESETBASE1",
        "requiredCandidate": false
      },
      {
        "label": "预设基础资料2",
        "key": "FPRESETBASE2",
        "requiredCandidate": false
      },
      {
        "label": "不包含B2C单据",
        "key": "FEXCLUDEB2CAR",
        "requiredCandidate": false
      },
      {
        "label": "同单据相同物料合并显示",
        "key": "FMergeSameMaterial",
        "requiredCandidate": false
      },
      {
        "label": "显示核销单",
        "key": "FShowMatchBill",
        "requiredCandidate": false
      }
    ],
    "modelFieldKeys": [
      "FAffiliation",
      "FSTARTYEAR",
      "FENDYEAR",
      "FCONTACTUNITTYPE",
      "FSTARTPERIOD",
      "FENDPERIOD",
      "FCONTACTUNITFrom",
      "FUSEDATE",
      "FUSEPERIOD",
      "FSettleOrgLst",
      "FCONTACTUNITTo",
      "FNoShowForBoth",
      "FNOAUDIT",
      "FNoShowForNoOccur",
      "FEndDate",
      "FBeginDate",
      "FNoShowForNoLeft",
      "FIncludePayEvaluate_New",
      "FCurrencyFrom",
      "FIncludePayEvaluate",
      "FOnlyShowPayEvaluate_New",
      "FDEFAULTACCTCALENDARID",
      "FOnlyShowPayEvaluate",
      "FOutSettle",
      "FGroupCustomer",
      "FShowSumLocal",
      "FShowLocal",
      "FInSettle",
      "FShowZeroAmountBill",
      "FAccountSystem",
      "FShowByMaterial",
      "FNoPreReceive",
      "FOnlyShowPreReceive",
      "FCONTACTUNITMUL",
      "FMULCONTACT",
      "FPRESETBASE1",
      "FPRESETBASE2",
      "FRedHookNotDisp",
      "FEXCLUDEB2CAR",
      "FMergeSameMaterial",
      "FShowMatchBill",
      "FDateRadioGrp"
    ],
    "modelNestedFieldPaths": [
      "FAffiliation.FNAME",
      "FCONTACTUNITFrom.FNumber",
      "FCONTACTUNITTo.FNumber",
      "FCurrencyFrom[].FNumber",
      "FAccountSystem.FNumber",
      "FPRESETBASE1[].FNumber",
      "FPRESETBASE2[].FNumber"
    ],
    "fieldCandidates": [
      {
        "label": "往来单位编码",
        "key": "FCONTACTUNITNUMBER"
      },
      {
        "label": "往来单位名称",
        "key": "FCONTACTUNITNAME"
      },
      {
        "label": "销售组织",
        "key": "FBUSINESSORGNAME"
      },
      {
        "label": "结算组织",
        "key": "FSETTLEORGNAME"
      },
      {
        "label": "收款组织",
        "key": "FRPORGNAME"
      },
      {
        "label": "销售部门名称",
        "key": "FBUSINESSDEPTNAME"
      },
      {
        "label": "销售组",
        "key": "FBUSINESSGROUPNAME"
      },
      {
        "label": "销售员",
        "key": "FBUSINESSERNAME"
      },
      {
        "label": "币别（原币）",
        "key": "FCURRENCYFORNAME"
      },
      {
        "label": "本期应收（原币）",
        "key": "FAMOUNTFOR"
      },
      {
        "label": "已开票金额（原币）",
        "key": "FHADIVAMOUNTFOR"
      },
      {
        "label": "本期收款（原币）",
        "key": "FREALAMOUNTFOR"
      },
      {
        "label": "本期冲销额（原币）",
        "key": "FOFFAMOUNTFOR"
      },
      {
        "label": "期末余额（原币）",
        "key": "FLEFTAMOUNTFOR"
      },
      {
        "label": "币别（本位币）",
        "key": "FCURRENCYNAME"
      },
      {
        "label": "本期应收（本位币）",
        "key": "FAMOUNT"
      },
      {
        "label": "已开票金额（本位币）",
        "key": "FHADIVAMOUNT"
      },
      {
        "label": "本期收款（本位币）",
        "key": "FREALAMOUNT"
      },
      {
        "label": "本期冲销额（本位币）",
        "key": "FOFFAMOUNT"
      },
      {
        "label": "期末余额（本位币）",
        "key": "FLEFTAMOUNT"
      },
      {
        "label": "集团客户",
        "key": "FGCUSTOMERNAME"
      },
      {
        "label": "客户",
        "key": "FCUSTID"
      },
      {
        "label": "客户分组",
        "key": "FCUSTGROUPNAME"
      },
      {
        "label": "销售部门",
        "key": "FBUSINESSDEPTID"
      },
      {
        "label": "销售部门分组",
        "key": "FBUSINESSDEPTGNAME"
      },
      {
        "label": "业务描述",
        "key": "FBUSINESSDESP"
      },
      {
        "label": "单据类型",
        "key": "FBILLTYPENAME"
      },
      {
        "label": "单据编号",
        "key": "FBILLNO"
      },
      {
        "label": "订单编号",
        "key": "FORDERNO"
      },
      {
        "label": "物料编码",
        "key": "FMaterialNumber"
      },
      {
        "label": "物料名称",
        "key": "FMaterialName"
      },
      {
        "label": "规格型号",
        "key": "FModel"
      },
      {
        "label": "批号",
        "key": "FLOT"
      },
      {
        "label": "计价单位",
        "key": "FUnit"
      },
      {
        "label": "计价数量",
        "key": "FQty"
      },
      {
        "label": "含税单价",
        "key": "FTaxPrice"
      },
      {
        "label": "折扣额",
        "key": "FDISCOUNTAMOUNTFOR"
      },
      {
        "label": "立账类型",
        "key": "FSetAccountType"
      },
      {
        "label": "现销",
        "key": "FCASHSALE"
      },
      {
        "label": "业务日期",
        "key": "FDATE"
      },
      {
        "label": "备注",
        "key": "FREMARK"
      },
      {
        "label": "订货方",
        "key": "FORDER"
      },
      {
        "label": "收货方",
        "key": "FTRANSFER"
      },
      {
        "label": "付款方",
        "key": "FCHARGE"
      },
      {
        "label": "收款用途",
        "key": "FRPOSEName"
      },
      {
        "label": "收款币别（原币）",
        "key": "FCURRENCYRECNAME"
      },
      {
        "label": "收款币别金额（原币）",
        "key": "FREFUNDAMOUNTFOR"
      },
      {
        "label": "源单类型",
        "key": "FSOURCEFORMNAME"
      },
      {
        "label": "源单编号",
        "key": "FSOURCEBILLNO"
      },
      {
        "label": "明细备注",
        "key": "FCOMMENT"
      },
      {
        "label": "客户物料名称",
        "key": "FCUSTMATNAME"
      },
      {
        "label": "客户物料编码",
        "key": "FCUSTMATNUMBER"
      },
      {
        "label": "是否转销生成",
        "key": "FISWRITEOFF"
      }
    ],
    "candidateFieldKeys": [
      "FCONTACTUNITNUMBER",
      "FCONTACTUNITNAME",
      "FBUSINESSORGNAME",
      "FSETTLEORGNAME",
      "FRPORGNAME",
      "FBUSINESSDEPTNAME",
      "FBUSINESSGROUPNAME",
      "FBUSINESSERNAME",
      "FCURRENCYFORNAME",
      "FAMOUNTFOR",
      "FHADIVAMOUNTFOR",
      "FREALAMOUNTFOR",
      "FOFFAMOUNTFOR",
      "FLEFTAMOUNTFOR",
      "FCURRENCYNAME",
      "FAMOUNT",
      "FHADIVAMOUNT",
      "FREALAMOUNT",
      "FOFFAMOUNT",
      "FLEFTAMOUNT",
      "FGCUSTOMERNAME",
      "FCUSTID",
      "FCUSTGROUPNAME",
      "FBUSINESSDEPTID",
      "FBUSINESSDEPTGNAME",
      "FBUSINESSDESP",
      "FBILLTYPENAME",
      "FBILLNO",
      "FORDERNO",
      "FMaterialNumber",
      "FMaterialName",
      "FModel",
      "FLOT",
      "FUnit",
      "FQty",
      "FTaxPrice",
      "FDISCOUNTAMOUNTFOR",
      "FSetAccountType",
      "FCASHSALE",
      "FDATE",
      "FREMARK",
      "FORDER",
      "FTRANSFER",
      "FCHARGE",
      "FRPOSEName",
      "FCURRENCYRECNAME",
      "FREFUNDAMOUNTFOR",
      "FSOURCEFORMNAME",
      "FSOURCEBILLNO",
      "FCOMMENT",
      "FCUSTMATNAME",
      "FCUSTMATNUMBER",
      "FISWRITEOFF"
    ],
    "localRowsAvailable": true,
    "interpretationConstraints": [
      "字段说明、Model 与 FieldKeys 仅取自本项指定附件；不可与其他 FormId 报告互套。",
      "示例未验证目标账套、公开方法分类、筛选口径、单位/币别口径或行粒度。"
    ],
    "validation": {
      "source": "用户附件中的 GetSysReportData 示例；仅证明附件展示该方法调用，不构成公开API分类或目标账套验证。",
      "attachmentMethodDemonstrated": true,
      "publicApiClassificationVerified": false,
      "targetLedgerValidated": false,
      "schemeIdValidated": false,
      "fieldKeysSelected": false,
      "requiredEnumsValidated": false,
      "responseEnvelopeValidated": false,
      "rowGrainValidated": false,
      "liveCallAllowed": false
    },
    "blockers": [
      "附件示例请求的SchemeId与顶层FieldKeys留空；附件显示列清单已独立保留为输出候选，尚未选入请求或验证。",
      "附件标注的必填单选/枚举值域及目标账套校验方式未验证。",
      "响应 envelope、RowCount、Rows 的实际形态和行粒度未在目标账套验证。",
      "目标账套的报表字段、方法可用性、权限及组织范围均未验证。",
      "本候选中没有可展示的本地业务行；仅采购与销售明细由独立本地 demo fixture 提供。"
    ]
  },
  {
    "id": "ap-aging",
    "name": "应付账龄",
    "formId": "AP_AgingAnalysis",
    "method": "GetSysReportData",
    "status": "candidate_unverified_locked",
    "liveState": "unverified",
    "executionStatus": "locked",
    "methodEvidence": "attachment_example",
    "publicApiClassification": "unverified",
    "targetAccountValidation": "unverified",
    "schemeId": null,
    "selectedFieldKeys": null,
    "sourceAttachment": null,
    "requestedAttachment": null,
    "sourceAttachmentMatchesRequestedPath": null,
    "sourceReportedFormId": "AP_AgingAnalysis",
    "sourceMatchesRequestedFormId": true,
    "parameterFields": [
      {
        "label": "日期",
        "key": "FByDate",
        "requiredCandidate": true
      },
      {
        "label": "往来单位类型",
        "key": "FCONTACTUNITTYPE",
        "requiredCandidate": false
      },
      {
        "label": "往来单位",
        "key": "FContactUnitFrom",
        "requiredCandidate": false
      },
      {
        "label": "业务日期",
        "key": "FRadioBusinessDate",
        "requiredCandidate": false
      },
      {
        "label": "到期日",
        "key": "FRadioEndDate",
        "requiredCandidate": false
      },
      {
        "label": "包括未审核单据",
        "key": "FUnAudit",
        "requiredCandidate": false
      },
      {
        "label": "按单据显示",
        "key": "FByBill",
        "requiredCandidate": false
      },
      {
        "label": "内部结算",
        "key": "FInSettle",
        "requiredCandidate": false
      },
      {
        "label": "会计核算体系",
        "key": "FAccountSystem",
        "requiredCandidate": false
      },
      {
        "label": "外部结算",
        "key": "FOutSettle",
        "requiredCandidate": false
      },
      {
        "label": "单选按钮组",
        "key": "FAgingCalStd",
        "requiredCandidate": false
      },
      {
        "label": "来自过滤条件",
        "key": "FIsFromFilter",
        "requiredCandidate": false
      },
      {
        "label": "往来单位",
        "key": "FContactUnitTo",
        "requiredCandidate": false
      },
      {
        "label": "结算组织",
        "key": "FSettleOrgLst",
        "requiredCandidate": true
      },
      {
        "label": "隶属方案",
        "key": "FAffiliation",
        "requiredCandidate": false
      },
      {
        "label": "包含暂估应付",
        "key": "FIncludePayEvaluate_New",
        "requiredCandidate": false
      },
      {
        "label": "仅显示暂估应付",
        "key": "FOnlyShowPayEvaluate_New",
        "requiredCandidate": false
      },
      {
        "label": "币别",
        "key": "FCurrencyFrom",
        "requiredCandidate": false
      },
      {
        "label": "截止日期的单据余额",
        "key": "FToEndDate",
        "requiredCandidate": false
      },
      {
        "label": "显示本位币",
        "key": "FShowLocal",
        "requiredCandidate": false
      },
      {
        "label": "不包含预付款",
        "key": "FNoPrePayment",
        "requiredCandidate": false
      },
      {
        "label": "仅显示预付款",
        "key": "FOnlyShowPrePayment",
        "requiredCandidate": false
      },
      {
        "label": "仅包含计入成本金额",
        "key": "FShowAmountInCost",
        "requiredCandidate": false
      },
      {
        "label": "多选",
        "key": "FMULCONTACT",
        "requiredCandidate": false
      },
      {
        "label": "往来单位",
        "key": "FCONTACTUNITMUL",
        "requiredCandidate": false
      },
      {
        "label": "显示综合本位币小计",
        "key": "FShowSumLocal",
        "requiredCandidate": false
      },
      {
        "label": "预设基础资料字段1",
        "key": "FPRESETBASE1",
        "requiredCandidate": false
      },
      {
        "label": "预设基础资料字段2",
        "key": "FPRESETBASE2",
        "requiredCandidate": false
      },
      {
        "label": "本位币余额按期末汇率重算",
        "key": "FReSetAllocateExc",
        "requiredCandidate": false
      },
      {
        "label": "调汇汇率类型",
        "key": "FExChangeRateType",
        "requiredCandidate": true
      },
      {
        "label": "账龄分组设置",
        "key": "FSection",
        "requiredCandidate": false
      },
      {
        "label": "天数",
        "key": "FDays",
        "requiredCandidate": true
      }
    ],
    "modelFieldKeys": [
      "FAffiliation",
      "FCONTACTUNITTYPE",
      "FContactUnitFrom",
      "FContactUnitTo",
      "FByDate",
      "FRadioBusinessDate",
      "FRadioEndDate",
      "FUnAudit",
      "FByBill",
      "FInSettle",
      "FAccountSystem",
      "FOutSettle",
      "FIsFromFilter",
      "FSettleOrgLst",
      "FIncludePayEvaluate_New",
      "FOnlyShowPayEvaluate_New",
      "FShowLocal",
      "FCurrencyFrom",
      "FShowSumLocal",
      "FToEndDate",
      "FNoPrePayment",
      "FOnlyShowPrePayment",
      "FShowAmountInCost",
      "FCONTACTUNITMUL",
      "FMULCONTACT",
      "FPRESETBASE1",
      "FPRESETBASE2",
      "FReSetAllocateExc",
      "FExChangeRateType",
      "FAgingCalStd",
      "FEntAgingGrpSetting"
    ],
    "modelNestedFieldPaths": [
      "FAffiliation.FNAME",
      "FContactUnitFrom.FNumber",
      "FContactUnitTo.FNumber",
      "FAccountSystem.FNumber",
      "FExChangeRateType.FNUMBER",
      "FEntAgingGrpSetting[].FSection",
      "FEntAgingGrpSetting[].FDays"
    ],
    "fieldCandidates": [
      {
        "label": "往来单位编码",
        "key": "FContactUnitNumber"
      },
      {
        "label": "往来单位",
        "key": "FCONTACTUNIT"
      },
      {
        "label": "币别",
        "key": "FCurrencyName"
      },
      {
        "label": "收付组织",
        "key": "FPAYORGNAME"
      },
      {
        "label": "结算组织",
        "key": "FSettleOrgName"
      },
      {
        "label": "采购组织",
        "key": "FPurchaseOrgName"
      },
      {
        "label": "采购部门",
        "key": "FPurchaseDeptName"
      },
      {
        "label": "采购组",
        "key": "FPurchaseGroupName"
      },
      {
        "label": "采购员",
        "key": "FPurchaserName"
      },
      {
        "label": "单据类型",
        "key": "FBillTypeName"
      },
      {
        "label": "单据编号",
        "key": "FBillNo"
      },
      {
        "label": "业务日期",
        "key": "FDate"
      },
      {
        "label": "到期日",
        "key": "FEndDate"
      },
      {
        "label": "地区",
        "key": "FPROVINCIAL"
      },
      {
        "label": "尚未付款金额(原币)",
        "key": "FBalanceAmtFor"
      },
      {
        "label": "币别(本位币)",
        "key": "FMasterCurrencyName"
      },
      {
        "label": "尚未付款金额(本位币)",
        "key": "FBalanceAmt"
      },
      {
        "label": "备注",
        "key": "FREMARK"
      },
      {
        "label": "立账类型",
        "key": "FSetAccountType"
      },
      {
        "label": "物料编码",
        "key": "FMATERIALNUMBER"
      },
      {
        "label": "物料名称",
        "key": "FMATERIALNAME"
      },
      {
        "label": "订单编号",
        "key": "FORDERNUMBER"
      },
      {
        "label": "供应商分组",
        "key": "FSUPPLIERGROUPNAME"
      },
      {
        "label": "付款条件",
        "key": "FPayConditon"
      },
      {
        "label": "是否转销生成",
        "key": "FISWRITEOFF"
      }
    ],
    "candidateFieldKeys": [
      "FContactUnitNumber",
      "FCONTACTUNIT",
      "FCurrencyName",
      "FPAYORGNAME",
      "FSettleOrgName",
      "FPurchaseOrgName",
      "FPurchaseDeptName",
      "FPurchaseGroupName",
      "FPurchaserName",
      "FBillTypeName",
      "FBillNo",
      "FDate",
      "FEndDate",
      "FPROVINCIAL",
      "FBalanceAmtFor",
      "FMasterCurrencyName",
      "FBalanceAmt",
      "FREMARK",
      "FSetAccountType",
      "FMATERIALNUMBER",
      "FMATERIALNAME",
      "FORDERNUMBER",
      "FSUPPLIERGROUPNAME",
      "FPayConditon",
      "FISWRITEOFF"
    ],
    "localRowsAvailable": false,
    "interpretationConstraints": [
      "字段说明、Model 与 FieldKeys 仅取自本项指定附件；不可与其他 FormId 报告互套。",
      "示例未验证目标账套、公开方法分类、筛选口径、单位/币别口径或行粒度。"
    ],
    "validation": {
      "source": "用户附件中的 GetSysReportData 示例；仅证明附件展示该方法调用，不构成公开API分类或目标账套验证。",
      "attachmentMethodDemonstrated": true,
      "publicApiClassificationVerified": false,
      "targetLedgerValidated": false,
      "schemeIdValidated": false,
      "fieldKeysSelected": false,
      "requiredEnumsValidated": false,
      "responseEnvelopeValidated": false,
      "rowGrainValidated": false,
      "liveCallAllowed": false
    },
    "blockers": [
      "附件示例请求的SchemeId与顶层FieldKeys留空；附件显示列清单已独立保留为输出候选，尚未选入请求或验证。",
      "附件标注的必填单选/枚举值域及目标账套校验方式未验证。",
      "响应 envelope、RowCount、Rows 的实际形态和行粒度未在目标账套验证。",
      "目标账套的报表字段、方法可用性、权限及组织范围均未验证。",
      "本候选中没有可展示的本地业务行；仅采购与销售明细由独立本地 demo fixture 提供。"
    ]
  },
  {
    "id": "ap-uninvoiced-detail",
    "name": "应付未开票明细",
    "formId": "AP_IVDetailReport",
    "method": "GetSysReportData",
    "status": "candidate_unverified_locked",
    "liveState": "unverified",
    "executionStatus": "locked",
    "methodEvidence": "attachment_example",
    "publicApiClassification": "unverified",
    "targetAccountValidation": "unverified",
    "schemeId": null,
    "selectedFieldKeys": null,
    "sourceAttachment": null,
    "requestedAttachment": null,
    "sourceAttachmentMatchesRequestedPath": null,
    "sourceReportedFormId": "AP_IVDetailReport",
    "sourceMatchesRequestedFormId": true,
    "parameterFields": [
      {
        "label": "往来单位类型",
        "key": "FCONTACTUNITTYPE",
        "requiredCandidate": false
      },
      {
        "label": "往来单位",
        "key": "FCONTACTUNITFrom",
        "requiredCandidate": false
      },
      {
        "label": "开始日期",
        "key": "FBeginDate",
        "requiredCandidate": false
      },
      {
        "label": "结束日期",
        "key": "FEndDate",
        "requiredCandidate": false
      },
      {
        "label": "按物料明细显示",
        "key": "FShowByMaterial",
        "requiredCandidate": false
      },
      {
        "label": "外部结算",
        "key": "FOutSettle",
        "requiredCandidate": false
      },
      {
        "label": "内部结算",
        "key": "FInSettle",
        "requiredCandidate": false
      },
      {
        "label": "会计核算体系",
        "key": "FAccountSystem",
        "requiredCandidate": false
      },
      {
        "label": "往来单位至",
        "key": "FCONTACTUNITTo",
        "requiredCandidate": false
      },
      {
        "label": "结算组织",
        "key": "FSettleOrgLst",
        "requiredCandidate": true
      },
      {
        "label": "隶属方案",
        "key": "FAffiliation",
        "requiredCandidate": false
      },
      {
        "label": "币别",
        "key": "FCurrencyFrom",
        "requiredCandidate": false
      },
      {
        "label": "采购增值税额计入成本",
        "key": "FPurTaxInCost",
        "requiredCandidate": false
      },
      {
        "label": "包含计入成本费用应付",
        "key": "FIncludeExpBill",
        "requiredCandidate": false
      },
      {
        "label": "包含所有费用应付",
        "key": "FInCludeAllExpBill",
        "requiredCandidate": false
      },
      {
        "label": "当期未开票余额为零不显示",
        "key": "FBalZeroNotDisp",
        "requiredCandidate": false
      },
      {
        "label": "包含其他应付",
        "key": "FINCLUDOTHER",
        "requiredCandidate": false
      },
      {
        "label": "入库业务类型",
        "key": "FINSTOCKBUSTYPE",
        "requiredCandidate": false
      },
      {
        "label": "价内税采购普票取不含税金额",
        "key": "FIVTakeNoTaxAmount",
        "requiredCandidate": false
      },
      {
        "label": "包含资产应付",
        "key": "FIncludeZCBill",
        "requiredCandidate": false
      }
    ],
    "modelFieldKeys": [
      "FAffiliation",
      "FCONTACTUNITTYPE",
      "FCONTACTUNITFrom",
      "FPurTaxInCost",
      "FSettleOrgLst",
      "FAccountSystem",
      "FInSettle",
      "FCONTACTUNITTo",
      "FShowByMaterial",
      "FEndDate",
      "FBeginDate",
      "FOutSettle",
      "FCurrencyFrom",
      "FIncludeExpBill",
      "FInCludeAllExpBill",
      "FBalZeroNotDisp",
      "FINCLUDOTHER",
      "FINSTOCKBUSTYPE",
      "FIVTakeNoTaxAmount",
      "FIncludeZCBill"
    ],
    "modelNestedFieldPaths": [
      "FAffiliation.FNAME",
      "FCONTACTUNITFrom.FNumber",
      "FAccountSystem.FNumber",
      "FCONTACTUNITTo.FNumber",
      "FCurrencyFrom[].FNumber"
    ],
    "fieldCandidates": [
      {
        "label": "往来单位编码",
        "key": "FCONTACTUNITNUMBER"
      },
      {
        "label": "往来单位名称",
        "key": "FCONTACTUNITNAME"
      },
      {
        "label": "币别",
        "key": "FCURRENCYFORNAME"
      },
      {
        "label": "业务描述",
        "key": "FBUSINESSDESP"
      },
      {
        "label": "单据编号",
        "key": "FBillNo"
      },
      {
        "label": "单据类型",
        "key": "FBILLTYPENAME"
      },
      {
        "label": "业务日期",
        "key": "FDate"
      },
      {
        "label": "采购部门",
        "key": "FBUSINESSDEPTNAME"
      },
      {
        "label": "采购组",
        "key": "FBUSINESSGROUPNAME"
      },
      {
        "label": "采购员",
        "key": "FBUSINESSERNAME"
      },
      {
        "label": "采购组织",
        "key": "FBUSINESSORGNAME"
      },
      {
        "label": "结算组织",
        "key": "FSETTLEORGNAME"
      },
      {
        "label": "物料编码",
        "key": "FMaterialNumber"
      },
      {
        "label": "物料名称",
        "key": "FMaterialName"
      },
      {
        "label": "规格型号",
        "key": "FModel"
      },
      {
        "label": "计价单位",
        "key": "FUnit"
      },
      {
        "label": "计价数量",
        "key": "FQty"
      },
      {
        "label": "期初余额（未开票明细）",
        "key": "FPAmountBegin"
      },
      {
        "label": "本期应付（未开票明细）",
        "key": "FPRECAMOUNT"
      },
      {
        "label": "本期开票（未开票明细）",
        "key": "FPPAMOUNT"
      },
      {
        "label": "期末余额（未开票明细）",
        "key": "FPLEFTAMOUNT"
      },
      {
        "label": "期初余额（暂估应付明细）",
        "key": "FOAmountBegin"
      },
      {
        "label": "本期暂估应付（暂估应付明细）",
        "key": "FOInOutAmount"
      },
      {
        "label": "本期暂估冲回（暂估应付明细）",
        "key": "FOOutAMOUNT"
      },
      {
        "label": "期末余额（暂估应付明细）",
        "key": "FOLEFTAMOUNT"
      },
      {
        "label": "备注",
        "key": "FREMARK"
      },
      {
        "label": "立账类型",
        "key": "FSetAccountType"
      },
      {
        "label": "明细备注",
        "key": "FCOMMENT"
      },
      {
        "label": "物料分组",
        "key": "FMaterialGroupName"
      }
    ],
    "candidateFieldKeys": [
      "FCONTACTUNITNUMBER",
      "FCONTACTUNITNAME",
      "FCURRENCYFORNAME",
      "FBUSINESSDESP",
      "FBillNo",
      "FBILLTYPENAME",
      "FDate",
      "FBUSINESSDEPTNAME",
      "FBUSINESSGROUPNAME",
      "FBUSINESSERNAME",
      "FBUSINESSORGNAME",
      "FSETTLEORGNAME",
      "FMaterialNumber",
      "FMaterialName",
      "FModel",
      "FUnit",
      "FQty",
      "FPAmountBegin",
      "FPRECAMOUNT",
      "FPPAMOUNT",
      "FPLEFTAMOUNT",
      "FOAmountBegin",
      "FOInOutAmount",
      "FOOutAMOUNT",
      "FOLEFTAMOUNT",
      "FREMARK",
      "FSetAccountType",
      "FCOMMENT",
      "FMaterialGroupName"
    ],
    "localRowsAvailable": true,
    "interpretationConstraints": [
      "字段说明、Model 与 FieldKeys 仅取自本项指定附件；不可与其他 FormId 报告互套。",
      "示例未验证目标账套、公开方法分类、筛选口径、单位/币别口径或行粒度。"
    ],
    "validation": {
      "source": "用户附件中的 GetSysReportData 示例；仅证明附件展示该方法调用，不构成公开API分类或目标账套验证。",
      "attachmentMethodDemonstrated": true,
      "publicApiClassificationVerified": false,
      "targetLedgerValidated": false,
      "schemeIdValidated": false,
      "fieldKeysSelected": false,
      "requiredEnumsValidated": false,
      "responseEnvelopeValidated": false,
      "rowGrainValidated": false,
      "liveCallAllowed": false
    },
    "blockers": [
      "附件示例请求的SchemeId与顶层FieldKeys留空；附件显示列清单已独立保留为输出候选，尚未选入请求或验证。",
      "附件标注的必填单选/枚举值域及目标账套校验方式未验证。",
      "响应 envelope、RowCount、Rows 的实际形态和行粒度未在目标账套验证。",
      "目标账套的报表字段、方法可用性、权限及组织范围均未验证。",
      "本候选中没有可展示的本地业务行；仅采购与销售明细由独立本地 demo fixture 提供。"
    ]
  },
  {
    "id": "ap-detail",
    "name": "应付明细",
    "formId": "AP_PAYDETAILREPORT",
    "method": "GetSysReportData",
    "status": "candidate_unverified_locked",
    "liveState": "unverified",
    "executionStatus": "locked",
    "methodEvidence": "attachment_example",
    "publicApiClassification": "unverified",
    "targetAccountValidation": "unverified",
    "schemeId": null,
    "selectedFieldKeys": null,
    "sourceAttachment": null,
    "requestedAttachment": null,
    "sourceAttachmentMatchesRequestedPath": null,
    "sourceReportedFormId": "AP_PAYDETAILREPORT",
    "sourceMatchesRequestedFormId": true,
    "parameterFields": [
      {
        "label": "往来单位类型",
        "key": "FCONTACTUNITTYPE",
        "requiredCandidate": false
      },
      {
        "label": "往来单位",
        "key": "FCONTACTUNITFrom",
        "requiredCandidate": false
      },
      {
        "label": "开始日期",
        "key": "FBeginDate",
        "requiredCandidate": false
      },
      {
        "label": "结束日期",
        "key": "FEndDate",
        "requiredCandidate": false
      },
      {
        "label": "包括未审核单据",
        "key": "FNOAUDIT",
        "requiredCandidate": false
      },
      {
        "label": "无发生额不显示",
        "key": "FNoShowForNoOccur",
        "requiredCandidate": false
      },
      {
        "label": "余额为零不显示",
        "key": "FNoShowForNoLeft",
        "requiredCandidate": false
      },
      {
        "label": "无发生额且余额为零不显示",
        "key": "FNoShowForBoth",
        "requiredCandidate": false
      },
      {
        "label": "外部结算",
        "key": "FOutSettle",
        "requiredCandidate": false
      },
      {
        "label": "内部结算",
        "key": "FInSettle",
        "requiredCandidate": false
      },
      {
        "label": "会计核算体系",
        "key": "FAccountSystem",
        "requiredCandidate": false
      },
      {
        "label": "往来单位至",
        "key": "FCONTACTUNITTo",
        "requiredCandidate": false
      },
      {
        "label": "结算组织",
        "key": "FSettleOrgLst",
        "requiredCandidate": true
      },
      {
        "label": "隶属方案",
        "key": "FAffiliation",
        "requiredCandidate": false
      },
      {
        "label": "币别",
        "key": "FCurrencyFrom",
        "requiredCandidate": false
      },
      {
        "label": "默认会计日历",
        "key": "FDEFAULTACCTCALENDARID",
        "requiredCandidate": false
      },
      {
        "label": "单选按钮组",
        "key": "FDateRadioGrp",
        "requiredCandidate": false
      },
      {
        "label": "按业务日期查询",
        "key": "FUSEDATE",
        "requiredCandidate": false
      },
      {
        "label": "按期间查询",
        "key": "FUSEPERIOD",
        "requiredCandidate": false
      },
      {
        "label": "会计期间",
        "key": "FSTARTPERIOD",
        "requiredCandidate": false
      },
      {
        "label": "会计年度",
        "key": "FSTARTYEAR",
        "requiredCandidate": false
      },
      {
        "label": "仅显示已入库未应付",
        "key": "FOnlyShowPayEvaluate",
        "requiredCandidate": false
      },
      {
        "label": "包含已入库未应付",
        "key": "FIncludePayEvaluate",
        "requiredCandidate": false
      },
      {
        "label": "包含暂估应付",
        "key": "FIncludePayEvaluate_New",
        "requiredCandidate": false
      },
      {
        "label": "仅显示暂估应付",
        "key": "FOnlyShowPayEvaluate_New",
        "requiredCandidate": false
      },
      {
        "label": "至",
        "key": "FENDYEAR",
        "requiredCandidate": false
      },
      {
        "label": "至",
        "key": "FENDPERIOD",
        "requiredCandidate": false
      },
      {
        "label": "按物料明细显示",
        "key": "FShowByMaterial",
        "requiredCandidate": false
      },
      {
        "label": "显示综合本位币小计",
        "key": "FShowSumLocal",
        "requiredCandidate": false
      },
      {
        "label": "显示本位币",
        "key": "FShowLocal",
        "requiredCandidate": false
      },
      {
        "label": "不包含预付款",
        "key": "FNoPrePayment",
        "requiredCandidate": false
      },
      {
        "label": "仅显示预付款",
        "key": "FOnlyShowPrePayment",
        "requiredCandidate": false
      },
      {
        "label": "仅包含计入成本金额",
        "key": "FShowAmountInCost",
        "requiredCandidate": false
      },
      {
        "label": "多选",
        "key": "FMULCONTACT",
        "requiredCandidate": false
      },
      {
        "label": "往来单位",
        "key": "FCONTACTUNITMUL",
        "requiredCandidate": false
      },
      {
        "label": "包含金额为零单据",
        "key": "FShowZeroAmountBill",
        "requiredCandidate": false
      },
      {
        "label": "当期暂估冲回不显示",
        "key": "FRedHookNotDisp",
        "requiredCandidate": false
      },
      {
        "label": "预设基础资料1",
        "key": "FPRESETBASE1",
        "requiredCandidate": false
      },
      {
        "label": "预设基础资料2",
        "key": "FPRESETBASE2",
        "requiredCandidate": false
      },
      {
        "label": "同单据相同物料合并显示",
        "key": "FMergeSameMaterial",
        "requiredCandidate": false
      },
      {
        "label": "集团供应商",
        "key": "FGROUPSUPPLIER",
        "requiredCandidate": false
      },
      {
        "label": "显示核销单",
        "key": "FShowMatchBill",
        "requiredCandidate": false
      }
    ],
    "modelFieldKeys": [
      "FAffiliation",
      "FSTARTYEAR",
      "FENDYEAR",
      "FCONTACTUNITTYPE",
      "FSTARTPERIOD",
      "FENDPERIOD",
      "FCONTACTUNITFrom",
      "FUSEPERIOD",
      "FUSEDATE",
      "FSettleOrgLst",
      "FCONTACTUNITTo",
      "FAccountSystem",
      "FInSettle",
      "FOutSettle",
      "FShowByMaterial",
      "FNoShowForNoLeft",
      "FNoShowForNoOccur",
      "FNOAUDIT",
      "FEndDate",
      "FBeginDate",
      "FNoShowForBoth",
      "FCurrencyFrom",
      "FIncludePayEvaluate",
      "FIncludePayEvaluate_New",
      "FDEFAULTACCTCALENDARID",
      "FOnlyShowPayEvaluate",
      "FOnlyShowPayEvaluate_New",
      "FShowLocal",
      "FShowSumLocal",
      "FShowZeroAmountBill",
      "FNoPrePayment",
      "FOnlyShowPrePayment",
      "FShowAmountInCost",
      "FCONTACTUNITMUL",
      "FMULCONTACT",
      "FPRESETBASE1",
      "FPRESETBASE2",
      "FRedHookNotDisp",
      "FMergeSameMaterial",
      "FGROUPSUPPLIER",
      "FShowMatchBill",
      "FDateRadioGrp"
    ],
    "modelNestedFieldPaths": [
      "FAffiliation.FNAME",
      "FCONTACTUNITFrom.FNumber",
      "FCONTACTUNITTo.FNumber",
      "FAccountSystem.FNumber",
      "FCurrencyFrom[].FNumber",
      "FPRESETBASE1[].FNumber",
      "FPRESETBASE2[].FNumber"
    ],
    "fieldCandidates": [
      {
        "label": "往来单位编码",
        "key": "FCONTACTUNITNUMBER"
      },
      {
        "label": "往来单位名称",
        "key": "FCONTACTUNITNAME"
      },
      {
        "label": "采购组织",
        "key": "FBUSINESSORGNAME"
      },
      {
        "label": "结算组织",
        "key": "FSETTLEORGNAME"
      },
      {
        "label": "付款组织",
        "key": "FRPORGNAME"
      },
      {
        "label": "采购部门名称",
        "key": "FBUSINESSDEPTNAME"
      },
      {
        "label": "采购组",
        "key": "FBUSINESSGROUPNAME"
      },
      {
        "label": "采购员",
        "key": "FBUSINESSERNAME"
      },
      {
        "label": "币别（原币）",
        "key": "FCURRENCYFORNAME"
      },
      {
        "label": "本期应付（原币）",
        "key": "FAMOUNTFOR"
      },
      {
        "label": "已开票金额（原币）",
        "key": "FHADIVAMOUNTFOR"
      },
      {
        "label": "本期付款（原币）",
        "key": "FREALAMOUNTFOR"
      },
      {
        "label": "本期冲销额（原币）",
        "key": "FOFFAMOUNTFOR"
      },
      {
        "label": "期末余额（原币）",
        "key": "FLEFTAMOUNTFOR"
      },
      {
        "label": "币别（本位币）",
        "key": "FCURRENCYNAME"
      },
      {
        "label": "本期应付（本位币）",
        "key": "FAMOUNT"
      },
      {
        "label": "已开票金额（本位币）",
        "key": "FHADIVAMOUNT"
      },
      {
        "label": "本期付款（本位币）",
        "key": "FREALAMOUNT"
      },
      {
        "label": "本期冲销额（本位币）",
        "key": "FOFFAMOUNT"
      },
      {
        "label": "期末余额（本位币）",
        "key": "FLEFTAMOUNT"
      },
      {
        "label": "供应商",
        "key": "FSUPPLIERID"
      },
      {
        "label": "供应商分组",
        "key": "FSUPPLIERGROUPNAME"
      },
      {
        "label": "采购部门",
        "key": "FBUSINESSDEPTID"
      },
      {
        "label": "采购部门分组",
        "key": "FBUSINESSDEPTGNAME"
      },
      {
        "label": "业务描述",
        "key": "FBUSINESSDESP"
      },
      {
        "label": "单据类型",
        "key": "FBILLTYPENAME"
      },
      {
        "label": "单据编号",
        "key": "FBILLNO"
      },
      {
        "label": "业务日期",
        "key": "FDATE"
      },
      {
        "label": "订单编号",
        "key": "FORDERNO"
      },
      {
        "label": "物料编码",
        "key": "FMaterialNumber"
      },
      {
        "label": "物料名称",
        "key": "FMaterialName"
      },
      {
        "label": "规格型号",
        "key": "FModel"
      },
      {
        "label": "批号",
        "key": "FLOT"
      },
      {
        "label": "计价单位",
        "key": "FUnit"
      },
      {
        "label": "计价数量",
        "key": "FQty"
      },
      {
        "label": "含税单价",
        "key": "FTaxPrice"
      },
      {
        "label": "折扣额",
        "key": "FDISCOUNTAMOUNTFOR"
      },
      {
        "label": "付款用途",
        "key": "FRPOSEName"
      },
      {
        "label": "立账类型",
        "key": "FSetAccountType"
      },
      {
        "label": "现购",
        "key": "FCASHSALE"
      },
      {
        "label": "备注",
        "key": "FREMARK"
      },
      {
        "label": "订货方",
        "key": "FORDER"
      },
      {
        "label": "供货方",
        "key": "FTRANSFER"
      },
      {
        "label": "收款方",
        "key": "FCHARGE"
      },
      {
        "label": "付款币别（原币）",
        "key": "FCURRENCYRECNAME"
      },
      {
        "label": "付款币别金额（原币）",
        "key": "FREFUNDAMOUNTFOR"
      },
      {
        "label": "源单类型",
        "key": "FSOURCEFORMNAME"
      },
      {
        "label": "源单编号",
        "key": "FSOURCEBILLNO"
      },
      {
        "label": "明细备注",
        "key": "FCOMMENT"
      },
      {
        "label": "集团供应商",
        "key": "FGROUPSUPPLIERNAME"
      },
      {
        "label": "是否转销生成",
        "key": "FISWRITEOFF"
      }
    ],
    "candidateFieldKeys": [
      "FCONTACTUNITNUMBER",
      "FCONTACTUNITNAME",
      "FBUSINESSORGNAME",
      "FSETTLEORGNAME",
      "FRPORGNAME",
      "FBUSINESSDEPTNAME",
      "FBUSINESSGROUPNAME",
      "FBUSINESSERNAME",
      "FCURRENCYFORNAME",
      "FAMOUNTFOR",
      "FHADIVAMOUNTFOR",
      "FREALAMOUNTFOR",
      "FOFFAMOUNTFOR",
      "FLEFTAMOUNTFOR",
      "FCURRENCYNAME",
      "FAMOUNT",
      "FHADIVAMOUNT",
      "FREALAMOUNT",
      "FOFFAMOUNT",
      "FLEFTAMOUNT",
      "FSUPPLIERID",
      "FSUPPLIERGROUPNAME",
      "FBUSINESSDEPTID",
      "FBUSINESSDEPTGNAME",
      "FBUSINESSDESP",
      "FBILLTYPENAME",
      "FBILLNO",
      "FDATE",
      "FORDERNO",
      "FMaterialNumber",
      "FMaterialName",
      "FModel",
      "FLOT",
      "FUnit",
      "FQty",
      "FTaxPrice",
      "FDISCOUNTAMOUNTFOR",
      "FRPOSEName",
      "FSetAccountType",
      "FCASHSALE",
      "FREMARK",
      "FORDER",
      "FTRANSFER",
      "FCHARGE",
      "FCURRENCYRECNAME",
      "FREFUNDAMOUNTFOR",
      "FSOURCEFORMNAME",
      "FSOURCEBILLNO",
      "FCOMMENT",
      "FGROUPSUPPLIERNAME",
      "FISWRITEOFF"
    ],
    "localRowsAvailable": true,
    "interpretationConstraints": [
      "字段说明、Model 与 FieldKeys 仅取自本项指定附件；不可与其他 FormId 报告互套。",
      "示例未验证目标账套、公开方法分类、筛选口径、单位/币别口径或行粒度。"
    ],
    "validation": {
      "source": "用户附件中的 GetSysReportData 示例；仅证明附件展示该方法调用，不构成公开API分类或目标账套验证。",
      "attachmentMethodDemonstrated": true,
      "publicApiClassificationVerified": false,
      "targetLedgerValidated": false,
      "schemeIdValidated": false,
      "fieldKeysSelected": false,
      "requiredEnumsValidated": false,
      "responseEnvelopeValidated": false,
      "rowGrainValidated": false,
      "liveCallAllowed": false
    },
    "blockers": [
      "附件示例请求的SchemeId与顶层FieldKeys留空；附件显示列清单已独立保留为输出候选，尚未选入请求或验证。",
      "附件标注的必填单选/枚举值域及目标账套校验方式未验证。",
      "响应 envelope、RowCount、Rows 的实际形态和行粒度未在目标账套验证。",
      "目标账套的报表字段、方法可用性、权限及组织范围均未验证。",
      "本候选中没有可展示的本地业务行；仅采购与销售明细由独立本地 demo fixture 提供。"
    ]
  },
  {
    "id": "ap-summary",
    "name": "应付汇总",
    "formId": "AP_SumReport",
    "method": "GetSysReportData",
    "status": "candidate_unverified_locked",
    "liveState": "unverified",
    "executionStatus": "locked",
    "methodEvidence": "attachment_example",
    "publicApiClassification": "unverified",
    "targetAccountValidation": "unverified",
    "schemeId": null,
    "selectedFieldKeys": null,
    "sourceAttachment": null,
    "requestedAttachment": null,
    "sourceAttachmentMatchesRequestedPath": null,
    "sourceReportedFormId": "AP_SumReport",
    "sourceMatchesRequestedFormId": true,
    "parameterFields": [
      {
        "label": "往来单位类型",
        "key": "FCONTACTUNITTYPE",
        "requiredCandidate": false
      },
      {
        "label": "往来单位",
        "key": "FCONTACTUNITFrom",
        "requiredCandidate": false
      },
      {
        "label": "开始日期",
        "key": "FBeginDate",
        "requiredCandidate": false
      },
      {
        "label": "结束日期",
        "key": "FEndDate",
        "requiredCandidate": false
      },
      {
        "label": "包括未审核单据",
        "key": "FNOAUDIT",
        "requiredCandidate": false
      },
      {
        "label": "无发生额不显示",
        "key": "FNoShowForNoOccur",
        "requiredCandidate": false
      },
      {
        "label": "余额为零不显示",
        "key": "FNoShowForNoLeft",
        "requiredCandidate": false
      },
      {
        "label": "无发生额且余额为零不显示",
        "key": "FNoShowForBoth",
        "requiredCandidate": false
      },
      {
        "label": "外部结算",
        "key": "FOutSettle",
        "requiredCandidate": false
      },
      {
        "label": "内部结算",
        "key": "FInSettle",
        "requiredCandidate": false
      },
      {
        "label": "会计核算体系",
        "key": "FAccountSystem",
        "requiredCandidate": false
      },
      {
        "label": "往来单位至",
        "key": "FCONTACTUNITTo",
        "requiredCandidate": false
      },
      {
        "label": "结算组织",
        "key": "FSettleOrgLst",
        "requiredCandidate": true
      },
      {
        "label": "隶属方案",
        "key": "FAffiliation",
        "requiredCandidate": false
      },
      {
        "label": "币别",
        "key": "FCurrencyFrom",
        "requiredCandidate": false
      },
      {
        "label": "默认会计日历",
        "key": "FDEFAULTACCTCALENDARID",
        "requiredCandidate": false
      },
      {
        "label": "单选按钮组",
        "key": "FDateRadioGrp",
        "requiredCandidate": false
      },
      {
        "label": "按业务日期查询",
        "key": "FUSEDATE",
        "requiredCandidate": false
      },
      {
        "label": "按期间查询",
        "key": "FUSEPERIOD",
        "requiredCandidate": false
      },
      {
        "label": "仅显示已入库未应付",
        "key": "FOnlyShowPayEvaluate",
        "requiredCandidate": false
      },
      {
        "label": "包含已入库未应付",
        "key": "FIncludePayEvaluate",
        "requiredCandidate": false
      },
      {
        "label": "会计期间",
        "key": "FSTARTPERIOD",
        "requiredCandidate": false
      },
      {
        "label": "会计年度",
        "key": "FSTARTYEAR",
        "requiredCandidate": false
      },
      {
        "label": "包含暂估应付",
        "key": "FIncludePayEvaluate_New",
        "requiredCandidate": false
      },
      {
        "label": "仅显示暂估应付",
        "key": "FOnlyShowPayEvaluate_New",
        "requiredCandidate": false
      },
      {
        "label": "至",
        "key": "FENDYEAR",
        "requiredCandidate": false
      },
      {
        "label": "至",
        "key": "FENDPERIOD",
        "requiredCandidate": false
      },
      {
        "label": "显示本位币",
        "key": "FShowLocal",
        "requiredCandidate": false
      },
      {
        "label": "显示综合本位币小计",
        "key": "FShowSumLocal",
        "requiredCandidate": false
      },
      {
        "label": "不包含预付款",
        "key": "FNoPrePayment",
        "requiredCandidate": false
      },
      {
        "label": "仅显示预付款",
        "key": "FOnlyShowPrePayment",
        "requiredCandidate": false
      },
      {
        "label": "仅包含计入成本金额",
        "key": "FShowAmountInCost",
        "requiredCandidate": false
      },
      {
        "label": "多选",
        "key": "FMULCONTACT",
        "requiredCandidate": false
      },
      {
        "label": "集团供应商",
        "key": "FGROUPSUPPLIER",
        "requiredCandidate": false
      },
      {
        "label": "往来单位",
        "key": "FCONTACTUNITMUL",
        "requiredCandidate": false
      },
      {
        "label": "预设基础资料2",
        "key": "FPRESETBASE2",
        "requiredCandidate": false
      },
      {
        "label": "预设基础资料1",
        "key": "FPRESETBASE1",
        "requiredCandidate": false
      },
      {
        "label": "期末余额",
        "key": "FPERIODAMOUNT",
        "requiredCandidate": false
      },
      {
        "label": "至",
        "key": "FTOPERIODAMOUNT",
        "requiredCandidate": false
      },
      {
        "label": "复选框",
        "key": "FCheckPeriod",
        "requiredCandidate": false
      },
      {
        "label": "显示核销单",
        "key": "FShowMatchBill",
        "requiredCandidate": false
      }
    ],
    "modelFieldKeys": [
      "FAffiliation",
      "FSTARTYEAR",
      "FENDYEAR",
      "FCONTACTUNITTYPE",
      "FSTARTPERIOD",
      "FENDPERIOD",
      "FCONTACTUNITFrom",
      "FUSEDATE",
      "FSettleOrgLst",
      "FCONTACTUNITTo",
      "FAccountSystem",
      "FInSettle",
      "FOutSettle",
      "FUSEPERIOD",
      "FNoShowForNoLeft",
      "FNoShowForNoOccur",
      "FNOAUDIT",
      "FEndDate",
      "FBeginDate",
      "FNoShowForBoth",
      "FCurrencyFrom",
      "FIncludePayEvaluate",
      "FIncludePayEvaluate_New",
      "FDEFAULTACCTCALENDARID",
      "FOnlyShowPayEvaluate",
      "FOnlyShowPayEvaluate_New",
      "FShowLocal",
      "FShowSumLocal",
      "FNoPrePayment",
      "FOnlyShowPrePayment",
      "FShowAmountInCost",
      "FCONTACTUNITMUL",
      "FMULCONTACT",
      "FPRESETBASE1",
      "FPRESETBASE2",
      "FGROUPSUPPLIER",
      "FPERIODAMOUNT",
      "FTOPERIODAMOUNT",
      "FCheckPeriod",
      "FShowMatchBill",
      "FDateRadioGrp"
    ],
    "modelNestedFieldPaths": [
      "FAffiliation.FNAME",
      "FCONTACTUNITFrom.FNumber",
      "FCONTACTUNITTo.FNumber",
      "FAccountSystem.FNumber",
      "FCurrencyFrom[].FNumber",
      "FPRESETBASE1[].FNumber",
      "FPRESETBASE2[].FNumber"
    ],
    "fieldCandidates": [
      {
        "label": "往来单位编码",
        "key": "FCONTACTUNITNUMBER"
      },
      {
        "label": "往来单位名称",
        "key": "FCONTACTUNITNAME"
      },
      {
        "label": "采购组织",
        "key": "FBUSINESSORGNAME"
      },
      {
        "label": "结算组织",
        "key": "FSETTLEORGNAME"
      },
      {
        "label": "付款组织",
        "key": "FRPORGNAME"
      },
      {
        "label": "采购部门名称",
        "key": "FBUSINESSDEPTNAME"
      },
      {
        "label": "采购组",
        "key": "FBUSINESSGROUPNAME"
      },
      {
        "label": "采购员",
        "key": "FBUSINESSERNAME"
      },
      {
        "label": "币别（原币）",
        "key": "FCURRENCYFORNAME"
      },
      {
        "label": "期初余额（原币）",
        "key": "FINITAMOUNTFOR"
      },
      {
        "label": "本期应付（原币）",
        "key": "FAMOUNTFOR"
      },
      {
        "label": "已开票金额（原币）",
        "key": "FHADIVAMOUNTFOR"
      },
      {
        "label": "本期付款（原币）",
        "key": "FREALAMOUNTFOR"
      },
      {
        "label": "本期冲销额（原币）",
        "key": "FOFFAMOUNTFOR"
      },
      {
        "label": "期末余额（原币）",
        "key": "FLEFTAMOUNTFOR"
      },
      {
        "label": "币别（本位币）",
        "key": "FCURRENCYNAME"
      },
      {
        "label": "期初余额（本位币）",
        "key": "FINITAMOUNT"
      },
      {
        "label": "本期应付（本位币）",
        "key": "FAMOUNT"
      },
      {
        "label": "已开票金额（本位币）",
        "key": "FHADIVAMOUNT"
      },
      {
        "label": "本期付款（本位币）",
        "key": "FREALAMOUNT"
      },
      {
        "label": "本期冲销额（本位币）",
        "key": "FOFFAMOUNT"
      },
      {
        "label": "期末余额（本位币）",
        "key": "FLEFTAMOUNT"
      },
      {
        "label": "期间",
        "key": "FYEARPERIOD"
      },
      {
        "label": "供应商",
        "key": "FSUPPLIERID"
      },
      {
        "label": "供应商分组",
        "key": "FSUPPLIERGROUPNAME"
      },
      {
        "label": "采购部门",
        "key": "FBUSINESSDEPTID"
      },
      {
        "label": "采购部门分组",
        "key": "FBUSINESSDEPTGNAME"
      },
      {
        "label": "单据类型",
        "key": "FBILLTYPENAME"
      },
      {
        "label": "付款币别（原币）",
        "key": "FCURRENCYRECNAME"
      },
      {
        "label": "付款币别金额（原币）",
        "key": "FREFUNDAMOUNTFOR"
      },
      {
        "label": "集团供应商",
        "key": "FGROUPSUPPLIERNAME"
      }
    ],
    "candidateFieldKeys": [
      "FCONTACTUNITNUMBER",
      "FCONTACTUNITNAME",
      "FBUSINESSORGNAME",
      "FSETTLEORGNAME",
      "FRPORGNAME",
      "FBUSINESSDEPTNAME",
      "FBUSINESSGROUPNAME",
      "FBUSINESSERNAME",
      "FCURRENCYFORNAME",
      "FINITAMOUNTFOR",
      "FAMOUNTFOR",
      "FHADIVAMOUNTFOR",
      "FREALAMOUNTFOR",
      "FOFFAMOUNTFOR",
      "FLEFTAMOUNTFOR",
      "FCURRENCYNAME",
      "FINITAMOUNT",
      "FAMOUNT",
      "FHADIVAMOUNT",
      "FREALAMOUNT",
      "FOFFAMOUNT",
      "FLEFTAMOUNT",
      "FYEARPERIOD",
      "FSUPPLIERID",
      "FSUPPLIERGROUPNAME",
      "FBUSINESSDEPTID",
      "FBUSINESSDEPTGNAME",
      "FBILLTYPENAME",
      "FCURRENCYRECNAME",
      "FREFUNDAMOUNTFOR",
      "FGROUPSUPPLIERNAME"
    ],
    "localRowsAvailable": true,
    "interpretationConstraints": [
      "字段说明、Model 与 FieldKeys 仅取自本项指定附件；不可与其他 FormId 报告互套。",
      "示例未验证目标账套、公开方法分类、筛选口径、单位/币别口径或行粒度。"
    ],
    "validation": {
      "source": "用户附件中的 GetSysReportData 示例；仅证明附件展示该方法调用，不构成公开API分类或目标账套验证。",
      "attachmentMethodDemonstrated": true,
      "publicApiClassificationVerified": false,
      "targetLedgerValidated": false,
      "schemeIdValidated": false,
      "fieldKeysSelected": false,
      "requiredEnumsValidated": false,
      "responseEnvelopeValidated": false,
      "rowGrainValidated": false,
      "liveCallAllowed": false
    },
    "blockers": [
      "附件示例请求的SchemeId与顶层FieldKeys留空；附件显示列清单已独立保留为输出候选，尚未选入请求或验证。",
      "附件标注的必填单选/枚举值域及目标账套校验方式未验证。",
      "响应 envelope、RowCount、Rows 的实际形态和行粒度未在目标账套验证。",
      "目标账套的报表字段、方法可用性、权限及组织范围均未验证。",
      "本候选中没有可展示的本地业务行；仅采购与销售明细由独立本地 demo fixture 提供。"
    ]
  },
  {
    "id": "cost-analysis",
    "name": "成本分析",
    "formId": "QINL_YSCBFXB",
    "method": "GetSysReportData",
    "status": "candidate_unverified_locked",
    "liveState": "unverified",
    "executionStatus": "locked",
    "methodEvidence": "attachment_example",
    "publicApiClassification": "unverified",
    "targetAccountValidation": "unverified",
    "schemeId": null,
    "selectedFieldKeys": null,
    "sourceAttachment": null,
    "requestedAttachment": null,
    "sourceAttachmentMatchesRequestedPath": null,
    "sourceReportedFormId": "QINL_YSCBFXB",
    "sourceMatchesRequestedFormId": true,
    "parameterFields": [
      {
        "label": "会计政策名称",
        "key": "FAcctPolicyName",
        "requiredCandidate": false
      },
      {
        "label": "核算组织编码",
        "key": "FACCTGORGID",
        "requiredCandidate": true
      },
      {
        "label": "核算体系名称",
        "key": "FACCTGSYSTEMNAME",
        "requiredCandidate": false
      },
      {
        "label": "开始会计年度",
        "key": "FYear",
        "requiredCandidate": true
      },
      {
        "label": "会计政策编码",
        "key": "FACCTPOLICYID",
        "requiredCandidate": true
      },
      {
        "label": "核算体系编码",
        "key": "FACCTGSYSTEMID",
        "requiredCandidate": true
      },
      {
        "label": "币别",
        "key": "FCurrencyID",
        "requiredCandidate": false
      },
      {
        "label": "核算组织名称",
        "key": "FACCTGORGNAME",
        "requiredCandidate": false
      },
      {
        "label": "开始会计期间",
        "key": "FPeriod",
        "requiredCandidate": true
      },
      {
        "label": "单据类型",
        "key": "FBILLTYPE",
        "requiredCandidate": false
      },
      {
        "label": "开始日期",
        "key": "FSTARTDATE",
        "requiredCandidate": false
      },
      {
        "label": "结束日期",
        "key": "FENDDATE",
        "requiredCandidate": false
      },
      {
        "label": "至",
        "key": "FENDMATERIALID",
        "requiredCandidate": false
      },
      {
        "label": "单据编号",
        "key": "FSTARTBILLNO",
        "requiredCandidate": false
      },
      {
        "label": "至",
        "key": "FENDBILLNO",
        "requiredCandidate": false
      },
      {
        "label": "产品编码",
        "key": "FSTARTMATERIALID",
        "requiredCandidate": false
      },
      {
        "label": "多选单据类型",
        "key": "FMULBILLTYPE",
        "requiredCandidate": false
      },
      {
        "label": "显示费用项目明细",
        "key": "FISSHOWDETAIL",
        "requiredCandidate": false
      },
      {
        "label": "成本中心",
        "key": "FSTARTCOSTCID",
        "requiredCandidate": false
      },
      {
        "label": "至",
        "key": "FENDCOSTCID",
        "requiredCandidate": false
      },
      {
        "label": "费用项目",
        "key": "FSTARTEXPENSEID",
        "requiredCandidate": false
      },
      {
        "label": "至",
        "key": "FENDEXPENSEID",
        "requiredCandidate": false
      },
      {
        "label": "业务类型",
        "key": "FFPROORDERTYPE",
        "requiredCandidate": false
      },
      {
        "label": "至",
        "key": "FENDPROORDERID",
        "requiredCandidate": false
      },
      {
        "label": "工单编号",
        "key": "FSTARTPROORDERID",
        "requiredCandidate": false
      },
      {
        "label": "销售部门",
        "key": "FSTARTSALEDEPT",
        "requiredCandidate": false
      },
      {
        "label": "至",
        "key": "FENDSALER",
        "requiredCandidate": false
      },
      {
        "label": "客户",
        "key": "FSTARTCUSTOMER",
        "requiredCandidate": false
      },
      {
        "label": "销售员",
        "key": "FSTARTSALER",
        "requiredCandidate": false
      },
      {
        "label": "至",
        "key": "FENDSALEDEPT",
        "requiredCandidate": false
      },
      {
        "label": "获取跨组织结算数据",
        "key": "FAcrossOrgOrder",
        "requiredCandidate": false
      },
      {
        "label": "至",
        "key": "FENDCUSTOMER",
        "requiredCandidate": false
      },
      {
        "label": "结束会计年度",
        "key": "FEndYear",
        "requiredCandidate": true
      },
      {
        "label": "结束会计期间",
        "key": "FEndPeriod",
        "requiredCandidate": true
      },
      {
        "label": "汇总依据",
        "key": "FGroupBy",
        "requiredCandidate": false
      },
      {
        "label": "只显示汇总行",
        "key": "FCHXTotal",
        "requiredCandidate": false
      },
      {
        "label": "客户类型",
        "key": "FCUSTOMERTYPE",
        "requiredCandidate": false
      },
      {
        "label": "按应收单获取收入成本",
        "key": "FGETCBFROMAR",
        "requiredCandidate": false
      },
      {
        "label": "单选按钮组",
        "key": "FRADIOGROUP",
        "requiredCandidate": false
      },
      {
        "label": "按期间查询",
        "key": "FRdPeriod",
        "requiredCandidate": false
      },
      {
        "label": "按日期查询",
        "key": "FRdData",
        "requiredCandidate": false
      },
      {
        "label": "显示各期间明细",
        "key": "FIsDisplayPeriod",
        "requiredCandidate": false
      },
      {
        "label": "统计暂估应收单和暂估冲回单",
        "key": "FISARAPINFO",
        "requiredCandidate": false
      },
      {
        "label": "收入按价税合计显示",
        "key": "FSHOWALLAMOUNTFOR",
        "requiredCandidate": false
      }
    ],
    "modelFieldKeys": [
      "FACCTGSYSTEMID",
      "FACCTGORGID",
      "FACCTPOLICYID",
      "FYear",
      "FPeriod",
      "FEndYear",
      "FSTARTMATERIALID",
      "FEndPeriod",
      "FENDMATERIALID",
      "FCurrencyID",
      "FSTARTBILLNO",
      "FFPROORDERTYPE",
      "FCHXTotal",
      "FENDSALEDEPT",
      "FSTARTSALER",
      "FSTARTCUSTOMER",
      "FENDSALER",
      "FSTARTSALEDEPT",
      "FSTARTEXPENSEID",
      "FENDEXPENSEID",
      "FSTARTCOSTCID",
      "FISSHOWDETAIL",
      "FMULBILLTYPE",
      "FENDDATE",
      "FSTARTDATE",
      "FBILLTYPE",
      "FENDCOSTCID",
      "FGroupBy",
      "FENDBILLNO",
      "FENDPROORDERID",
      "FSTARTPROORDERID",
      "FAcrossOrgOrder",
      "FENDCUSTOMER",
      "FCUSTOMERTYPE",
      "FGETCBFROMAR",
      "FISARAPINFO",
      "FRADIOGROUP",
      "FRdPeriod",
      "FRdData",
      "FIsDisplayPeriod",
      "FSHOWALLAMOUNTFOR"
    ],
    "modelNestedFieldPaths": [
      "FACCTGSYSTEMID.FNumber",
      "FACCTGORGID.FNumber",
      "FACCTPOLICYID.FNumber",
      "FSTARTMATERIALID.FNumber",
      "FENDMATERIALID.FNumber",
      "FCurrencyID.FNumber",
      "FENDSALEDEPT.FNUMBER",
      "FSTARTSALER.FNUMBER",
      "FSTARTCUSTOMER.FNUMBER",
      "FENDSALER.FNUMBER",
      "FSTARTSALEDEPT.FNUMBER",
      "FSTARTEXPENSEID.FNumber",
      "FENDEXPENSEID.FNumber",
      "FSTARTCOSTCID.FNumber",
      "FENDCOSTCID.FNumber",
      "FENDCUSTOMER.FNUMBER"
    ],
    "fieldCandidates": [
      {
        "label": "产品",
        "key": "FMATERIALID"
      },
      {
        "label": "物料分组",
        "key": "FgroupName"
      }
    ],
    "candidateFieldKeys": [
      "FMATERIALID",
      "FgroupName"
    ],
    "localRowsAvailable": false,
    "interpretationConstraints": [
      "字段说明、Model 与 FieldKeys 仅取自本项指定附件；不可与其他 FormId 报告互套。",
      "示例未验证目标账套、公开方法分类、筛选口径、单位/币别口径或行粒度。"
    ],
    "validation": {
      "source": "用户附件中的 GetSysReportData 示例；仅证明附件展示该方法调用，不构成公开API分类或目标账套验证。",
      "attachmentMethodDemonstrated": true,
      "publicApiClassificationVerified": false,
      "targetLedgerValidated": false,
      "schemeIdValidated": false,
      "fieldKeysSelected": false,
      "requiredEnumsValidated": false,
      "responseEnvelopeValidated": false,
      "rowGrainValidated": false,
      "liveCallAllowed": false
    },
    "blockers": [
      "附件示例请求的SchemeId与顶层FieldKeys留空；附件显示列清单已独立保留为输出候选，尚未选入请求或验证。",
      "附件标注的必填单选/枚举值域及目标账套校验方式未验证。",
      "响应 envelope、RowCount、Rows 的实际形态和行粒度未在目标账套验证。",
      "目标账套的报表字段、方法可用性、权限及组织范围均未验证。",
      "本候选中没有可展示的本地业务行；仅采购与销售明细由独立本地 demo fixture 提供。"
    ]
  }
]

export const AR_SUMMARY_PLACEHOLDER = {
  "id": "ar-summary-placeholder",
  "name": "AR汇总待定义",
  "status": "not_defined",
  "liveState": "pending",
  "executionStatus": "locked",
  "formId": null,
  "method": null,
  "sourceAttachment": null,
  "fieldCandidates": [],
  "modelFieldKeys": [],
  "blocker": "暂无用户确认的 FormId、附件字段或查询契约；仅作占位，不猜测、不查询、不展示行数据或 KPI。"
} as const
