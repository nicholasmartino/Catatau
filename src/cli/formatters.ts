import chalk from "chalk";
import Table from "cli-table3";
import type { Campground } from "../types/park.js";
import type { AvailableSite } from "../types/availability.js";
import type { EquipmentCategory } from "../types/equipment.js";

export function formatCampgroundTable(campgrounds: Campground[]): string {
  const table = new Table({
    head: [
      chalk.cyan("ID"),
      chalk.cyan("Name"),
      chalk.cyan("Map ID"),
      chalk.cyan("Region"),
      chalk.cyan("Alerts"),
    ],
    colWidths: [10, 40, 10, 10, 10],
  });

  for (const cg of campgrounds) {
    table.push([
      cg.id,
      cg.name,
      cg.mapId,
      cg.regionId,
      cg.hasAlerts ? chalk.yellow("Yes") : "No",
    ]);
  }

  return table.toString();
}

export function formatAvailabilityTable(sites: AvailableSite[]): string {
  if (sites.length === 0) {
    return chalk.red("No available sites found.");
  }

  const table = new Table({
    head: [
      chalk.green("Site"),
      chalk.green("Campground"),
      chalk.green("Resource ID"),
      chalk.green("Map ID"),
    ],
    colWidths: [20, 35, 15, 10],
  });

  for (const site of sites) {
    table.push([
      site.siteName,
      site.campgroundName,
      site.resourceId,
      site.mapId,
    ]);
  }

  let output = table.toString();
  output += `\n\n${chalk.green.bold(`${sites.length} site(s) available!`)}`;

  // Show unique booking URLs
  const urls = [...new Set(sites.map((s) => s.bookingUrl))];
  if (urls.length > 0) {
    output += `\n\n${chalk.cyan("Booking URLs:")}`;
    for (const url of urls) {
      output += `\n  ${chalk.underline(url)}`;
    }
  }

  return output;
}

export function formatEquipmentTable(
  equipment: EquipmentCategory[],
): string {
  const table = new Table({
    head: [
      chalk.cyan("Category ID"),
      chalk.cyan("Name"),
      chalk.cyan("Sub-Categories"),
    ],
    colWidths: [15, 30, 50],
  });

  for (const eq of equipment) {
    const subs = eq.subEquipmentCategories
      .map((s) => `${s.localizedValues.en} (${s.subEquipmentCategoryId})`)
      .join(", ");

    table.push([eq.equipmentCategoryId, eq.localizedValues.en, subs || "-"]);
  }

  return table.toString();
}

export function printHeader(text: string): void {
  console.log(chalk.bold.blue(`\n${text}`));
  console.log(chalk.blue("─".repeat(60)));
}

export function printSuccess(text: string): void {
  console.log(chalk.green(`✓ ${text}`));
}

export function printWarning(text: string): void {
  console.log(chalk.yellow(`⚠ ${text}`));
}

export function printError(text: string): void {
  console.log(chalk.red(`✗ ${text}`));
}
