const fs = require('node:fs');
const path = require('node:path');

const iconModules = {
  dashboard: 'DashboardSquare01Icon',
  invoice: 'Invoice01Icon',
  category: 'Chart01Icon',
  analytics: 'ChartLineIcon',
  planning: 'PiggyBankIcon',
  settings: 'Settings01Icon',
  plus: 'Add01Icon',
  logout: 'Logout01Icon',
  search: 'Search01Icon',
  filter: 'FilterIcon',
  notifications: 'Notification01Icon',
  account: 'UserCircleIcon',
  close: 'Cancel01Icon',
  calendar: 'Calendar01Icon',
  tag: 'Tag01Icon',
  wallet: 'Wallet03Icon',
  'external-link': 'ArrowUpRight01Icon',
  target: 'Target02Icon',
  'arrow-right': 'ArrowRight01Icon',
  'arrow-left': 'ArrowLeft01Icon',
  income: 'MoneyBag02Icon',
  'chart-column': 'ChartColumnIcon',
  check: 'CheckmarkCircle01Icon',
  warning: 'Alert01Icon',
  clock: 'Clock01Icon',
  food: 'Restaurant01Icon',
  transport: 'Car01Icon',
  housing: 'House01Icon',
  entertainment: 'Film01Icon',
  utilities: 'Plug01Icon',
  savings: 'PiggyBankIcon',
  other: 'Shapes01Icon',
  layers: 'Layers01Icon',
  'chevron-down': 'ChevronDownIcon'
};

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderElement([tag, attributes]) {
  const renderedAttributes = Object.entries(attributes)
    .filter(([name]) => name !== 'key')
    .map(([name, value]) => {
      const attributeName = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      return `${attributeName}="${escapeXml(value)}"`;
    })
    .join(' ');
  return `<${tag} ${renderedAttributes}/>`;
}

const symbols = Object.entries(iconModules).map(([name, moduleName]) => {
  const paths = require(`@hugeicons/core-free-icons/${moduleName}`);
  return `<symbol id="${name}" viewBox="0 0 24 24">${paths.map(renderElement).join('')}</symbol>`;
});

const assetsDirectory = path.join(__dirname, '..', 'assets');
fs.mkdirSync(assetsDirectory, { recursive: true });
fs.writeFileSync(
  path.join(assetsDirectory, 'hugeicons.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg">${symbols.join('')}</svg>\n`
);

const packageDirectory = path.dirname(require.resolve('@hugeicons/core-free-icons/package.json'));
fs.copyFileSync(
  path.join(packageDirectory, 'LICENSE.md'),
  path.join(assetsDirectory, 'hugeicons-LICENSE.md')
);

console.log(`Built ${symbols.length} Hugeicons symbols in assets/hugeicons.svg`);
