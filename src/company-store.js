'use strict';

const fs = require('fs');
const path = require('path');
const { ensureDir, readJson, writeJsonAtomic, removeIfExists } = require('./storage');

const DEFAULT_DEPARTMENTS = ['Management', 'Marketing', 'IT', 'Finance', 'Sales', 'Design', 'HR'];
const ROLES = ['ceo', 'director', 'manager', 'lead', 'employee'];
const IMAGE_TYPES = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/x-icon': '.ico',
};

class CompanyStore {
  constructor(dataDir) {
    this.dir = ensureDir(path.join(dataDir, 'company'));
    this.file = path.join(this.dir, 'config.json');
  }

  get() {
    if (!fs.existsSync(this.file)) return null;
    const cfg = readJson(this.file, null);
    return cfg && typeof cfg === 'object' ? cfg : null;
  }

  save(input = {}) {
    const existing = this.get();
    const logoProvided = Object.prototype.hasOwnProperty.call(input, 'logo');
    const logo = logoProvided ? (validLogoName(input.logo) ? input.logo : null) : (existing && validLogoName(existing.logo) ? existing.logo : null);
    if (logoProvided && !logo && existing && existing.logo) removeIfExists(path.join(this.dir, path.basename(existing.logo)));
    const registeredAs = ROLES.includes(input.registeredAs) ? input.registeredAs : 'ceo';
    const departments = uniqueStrings(input.departments, DEFAULT_DEPARTMENTS);
    const ownerInput = input.owner && typeof input.owner === 'object' ? input.owner : {};
    const owner = {
      name: text(ownerInput.name, 'Owner', 120),
      employeeId: text(ownerInput.employeeId, '0001', 80),
      role: ROLES.includes(ownerInput.role) ? ownerInput.role : registeredAs,
      department: text(ownerInput.department, departments[0] || 'Management', 120),
    };
    const employees = Array.isArray(input.employees) ? input.employees.map(cleanEmployee).filter((item) => item.name) : [];
    if (!employees.some((item) => item.employeeId === owner.employeeId)) {
      employees.unshift({ ...owner, deviceId: '' });
    }
    const preferences = {
      workHours: clampNumber(input.preferences && input.preferences.workHours, 1, 12, 8),
      weekdays: uniqueStrings(input.preferences && input.preferences.weekdays, ['sun', 'mon', 'tue', 'wed', 'thu']).filter((day) => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].includes(day)),
      autoBackup: Boolean(input.preferences && input.preferences.autoBackup),
      backupPath: text(input.preferences && input.preferences.backupPath, '', 500),
      reminders: input.preferences && input.preferences.reminders !== false,
      funEnabled: input.preferences && input.preferences.funEnabled !== false,
      keepDemoRecords: input.preferences && input.preferences.keepDemoRecords !== false,
    };
    const clean = {
      companyName: text(input.companyName, 'SEO For All', 160),
      tagline: text(input.tagline, 'Company Intelligence OS', 240),
      logo,
      timezone: text(input.timezone, 'Africa/Cairo', 100),
      country: text(input.country, '', 100),
      currency: text(input.currency, 'EGP', 12).toUpperCase(),
      registeredAs,
      owner,
      departments,
      employees,
      preferences,
      updatedAt: new Date().toISOString(),
      createdAt: existing && existing.createdAt ? existing.createdAt : new Date().toISOString(),
    };
    if (!clean.preferences.weekdays.length) clean.preferences.weekdays = ['sun', 'mon', 'tue', 'wed', 'thu'];
    return writeJsonAtomic(this.file, clean);
  }

  reset() {
    const cfg = this.get();
    if (cfg && cfg.logo) removeIfExists(path.join(this.dir, path.basename(cfg.logo)));
    return removeIfExists(this.file);
  }

  saveLogo({ mimeType, dataBase64 }) {
    const ext = IMAGE_TYPES[String(mimeType || '').toLowerCase()];
    if (!ext) throw new Error('Unsupported logo type. Use PNG, JPG, WEBP, SVG, or ICO.');
    const raw = String(dataBase64 || '').replace(/^data:[^;]+;base64,/, '');
    if (!raw || raw.length > 9_000_000) throw new Error('Logo is empty or larger than 6 MB.');
    const buffer = Buffer.from(raw, 'base64');
    if (!buffer.length || buffer.length > 6 * 1024 * 1024) throw new Error('Logo is empty or larger than 6 MB.');
    if (ext === '.svg') validateSvg(buffer.toString('utf8'));
    for (const oldExt of Object.values(IMAGE_TYPES)) removeIfExists(path.join(this.dir, `logo${oldExt}`));
    const filename = `logo${ext}`;
    fs.writeFileSync(path.join(this.dir, filename), buffer, { mode: 0o600 });
    return filename;
  }

  logoPath(filename) {
    if (!validLogoName(filename)) return null;
    const file = path.join(this.dir, path.basename(filename));
    return fs.existsSync(file) ? file : null;
  }

  upsertEmployee(employee = {}) {
    const cfg = this.get();
    if (!cfg) return null;
    const clean = cleanEmployee({ ...employee, role: employee.role || 'employee', deviceId: employee.deviceId || employee.employeeId });
    if (!clean.name || !clean.employeeId) return cfg;
    const list = Array.isArray(cfg.employees) ? cfg.employees.slice() : [];
    const index = list.findIndex((item) => item.employeeId === clean.employeeId || (clean.deviceId && item.deviceId === clean.deviceId));
    if (index >= 0) list[index] = clean; else list.push(clean);
    return this.save({ ...cfg, employees: list });
  }

  buildAppData() {
    const cfg = this.get();
    if (!cfg) return null;
    return {
      employees: (cfg.employees || []).map((employee) => ({
        name: employee.name,
        department: employee.department || 'General',
        role: employee.role || 'employee',
        employeeId: employee.employeeId,
        deviceId: employee.deviceId || '',
        tasks: 0,
        quality: 0,
        assists: 0,
        hours: 0,
        attendance: 0,
        late: 0,
        overdue: 0,
        deductions: 0,
        managerRating: 0,
        projects: 0,
      })),
    };
  }
}

function cleanEmployee(employee = {}) {
  return {
    name: text(employee.name, '', 120),
    employeeId: text(employee.employeeId, '', 80),
    department: text(employee.department, 'General', 120),
    role: ROLES.includes(employee.role) ? employee.role : 'employee',
    deviceId: text(employee.deviceId, '', 80),
  };
}

function text(value, fallback, max) {
  const output = String(value == null ? fallback : value).trim();
  return output.slice(0, max);
}

function uniqueStrings(value, fallback) {
  const source = Array.isArray(value) && value.length ? value : fallback;
  return [...new Set(source.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 200);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function validLogoName(filename) {
  return /^logo\.(png|jpg|webp|svg|ico)$/i.test(String(filename || ''));
}

function validateSvg(svg) {
  if (!/^\s*<svg\b/i.test(svg)) throw new Error('Invalid SVG file.');
  if (/<script\b|\bon\w+\s*=|javascript:|<foreignObject\b/i.test(svg)) throw new Error('Unsafe SVG content is not allowed.');
}

module.exports = { CompanyStore, ROLES, DEFAULT_DEPARTMENTS, validLogoName };
