# 2026-05-26 全球手机号国家码选择器与验证集成设计文档

## 1. 目标
支持在登录介面（包含国内版 `LoginScreen` 与全球版 `LoginGlobalScreen`）中选择全世界所有国家/地区的手机号国家码，支持搜索过滤，并且基于各国的手机号长度限制进行动态长度校验与错误提示。

## 2. 设计方案

### 2.1 全球国家码数据源
在移动端项目中新建一个统一的数据源文件 `apps/mobile/src/constants/countries.ts`。
每个国家/地区包含以下属性：
* `code`: 拨号前缀（例如 `+86`, `+1`, `+65`）
* `iso`: ISO 3166-1 alpha-2 两位代码（例如 `CN`, `US`, `SG`）
* `nameEn`: 英文名称
* `nameZh`: 中文名称
* `flag`: 国旗 Emoji 字符（无需加载图片资源）
* `minLength`: 该国家手机号最小长度
* `maxLength`: 该国家手机号最大长度

示例：
```typescript
export interface CountryCodeInfo {
  code: string;
  iso: string;
  nameEn: string;
  nameZh: string;
  flag: string;
  minLength: number;
  maxLength: number;
}

export const COUNTRY_CODES: CountryCodeInfo[] = [
  { code: '+86', iso: 'CN', nameEn: 'China', nameZh: '中国', flag: '🇨🇳', minLength: 11, maxLength: 11 },
  { code: '+1', iso: 'US', nameEn: 'United States', nameZh: '美国', flag: '🇺🇸', minLength: 10, maxLength: 10 },
  // ... 包含全球 200+ 国家与地区
];
```

### 2.2 登录界面集成方案

#### 2.2.1 国内版登录界面 (`LoginScreen.tsx`)
* **国家码触发按钮**：将目前写死的 `+86` 替换为可点击的按钮（显示形式为：`🇨🇳 +86 ▼`），并与之联动显示。
* **自定义半屏抽屉选择器**：
  * 点击触发按钮时弹出半屏抽屉式 Modal。
  * 抽屉顶部带有搜索框，支持按照国家中文名、英文名、前缀（例如 `86` 或 `+86`）进行模糊匹配和实时过滤。
  * 列表支持高效渲染，点击国家后自动切换，并关闭弹窗。
* **输入长度与校验规则**：
  * 允许通过 `handlePhoneChange` 输入的字符上限动态调整为 `selectedCountry.maxLength`。
  * 如果选中的是 `+86`（中国），保持原有的 `isValidChinaPhone` 格式校验。
  * 如果选中其他国家，校验是否全为数字且长度位于 `[minLength, maxLength]` 之间。

#### 2.2.2 全球版登录界面 (`LoginGlobalScreen.tsx`)
* **替换数据源**：将目前包含 11 个国家的写死 `COUNTRY_CODES` 数组替换为引入自 `countries.ts` 的全球 200+ 国家列表。
* **添加过滤搜索框**：
  * 全球版原本的国家选择 Modal 不包含搜索框，在集成 200+ 国家后非常需要搜索功能。
  * 在 Modal Header 下方增加一个带放大镜图标的搜索过滤输入框，支持输入中文、英文或区号实时过滤。
* **逻辑优化**：
  * 输入校验保持原有逻辑（中国号码特殊正则，其他国家按 min/max 长度及纯数字校验），但使用统一的数据源。

### 2.3 国际化翻译与本地化支持
* 国内版 `LoginScreen` 支持简繁中英文切换，弹窗内的国家名称显示应动态契合当前语系。
* 在列表中显示格式如 `flag` + `nameZh (nameEn)` 或动态显示为 `t('locale') === 'zh' ? nameZh : nameEn`。

## 3. 验证计划
1. **类型检查与编译验证**：在移动端目录下运行 `pnpm --filter @lynavo-drive/mobile exec tsc --noEmit`，确保无 TypeScript 错误。
2. **测试用例验证**：
   * 运行原本的登录屏幕测试用例：`pnpm --filter @lynavo-drive/mobile test LoginScreen.test.tsx` 和 `LoginGlobalScreen.test.tsx`。
   * 更新受国家码数据结构和验证规则变动影响的 Mock 逻辑。
3. **界面与交互验证**：
   * 确保国家码列表支持中英文搜索（例如输入 "新"、"Singa"、"65" 均可匹配新加坡）。
   * 输入不同国家手机号时，最大可输入长度限制正确跟随变化。
