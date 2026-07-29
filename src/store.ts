import { Database } from "bun:sqlite";
import type { AranetDevice, AranetReading } from "./home-assistant.ts";

export interface PluginConfiguration {
  haUrl: string;
  encryptedHaToken: string;
  device: AranetDevice;
}

export interface PendingInstallation {
  accessTokenHash: string;
  installationState: string;
  callbackUrl: string;
  createdAt: string;
}

export interface Activation {
  accessTokenHash: string;
  userUuid: string;
  pluginSettingId: number;
  instanceName: string;
  locale: string;
  timeZone: string;
}

export interface PluginConnection extends Activation {
  configuration: PluginConfiguration;
  lastReading: AranetReading | null;
}

interface ConnectionRow {
  access_token_hash: string;
  installation_state: string;
  callback_url: string;
  created_at: string;
  ha_url: string | null;
  ha_token_ciphertext: string | null;
  device_json: string | null;
  user_uuid: string | null;
  plugin_setting_id: number | null;
  instance_name: string | null;
  locale: string | null;
  time_zone: string | null;
  reading_json: string | null;
}

export class PluginStore {
  readonly #database: Database;

  constructor(path: string) {
    this.#database = new Database(path, { create: true, strict: true });
    this.#database.exec("PRAGMA journal_mode = WAL;");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS plugin_connections (
        access_token_hash TEXT PRIMARY KEY,
        installation_state TEXT NOT NULL UNIQUE,
        callback_url TEXT NOT NULL,
        created_at TEXT NOT NULL,
        ha_url TEXT,
        ha_token_ciphertext TEXT,
        device_json TEXT,
        user_uuid TEXT UNIQUE,
        plugin_setting_id INTEGER,
        instance_name TEXT,
        locale TEXT,
        time_zone TEXT,
        reading_json TEXT
      );
    `);
  }

  close(): void {
    this.#database.close();
  }

  createPending(installation: PendingInstallation): void {
    this.#database
      .query(`
        INSERT INTO plugin_connections (
          access_token_hash, installation_state, callback_url, created_at
        ) VALUES (?, ?, ?, ?)
      `)
      .run(
        installation.accessTokenHash,
        installation.installationState,
        installation.callbackUrl,
        installation.createdAt,
      );
  }

  getPendingByState(state: string): PendingInstallation | null {
    const row = this.#database
      .query<ConnectionRow, [string]>(
        "SELECT * FROM plugin_connections WHERE installation_state = ?",
      )
      .get(state);
    if (!row) return null;
    return {
      accessTokenHash: row.access_token_hash,
      installationState: row.installation_state,
      callbackUrl: row.callback_url,
      createdAt: row.created_at,
    };
  }

  saveConfiguration(state: string, configuration: PluginConfiguration): void {
    const result = this.#database
      .query(`
        UPDATE plugin_connections
        SET ha_url = ?, ha_token_ciphertext = ?, device_json = ?
        WHERE installation_state = ?
      `)
      .run(
        configuration.haUrl,
        configuration.encryptedHaToken,
        JSON.stringify(configuration.device),
        state,
      );
    if (result.changes !== 1) {
      throw new Error("Installation session not found");
    }
  }

  updateConfigurationByUserUuid(
    userUuid: string,
    configuration: PluginConfiguration,
  ): void {
    const result = this.#database
      .query(`
        UPDATE plugin_connections
        SET ha_url = ?, ha_token_ciphertext = ?, device_json = ?
        WHERE user_uuid = ?
      `)
      .run(
        configuration.haUrl,
        configuration.encryptedHaToken,
        JSON.stringify(configuration.device),
        userUuid,
      );
    if (result.changes !== 1) {
      throw new Error("Plugin connection not found");
    }
  }

  activate(activation: Activation): void {
    const result = this.#database
      .query(`
        UPDATE plugin_connections
        SET user_uuid = ?, plugin_setting_id = ?, instance_name = ?,
            locale = ?, time_zone = ?
        WHERE access_token_hash = ? AND ha_url IS NOT NULL
      `)
      .run(
        activation.userUuid,
        activation.pluginSettingId,
        activation.instanceName,
        activation.locale,
        activation.timeZone,
        activation.accessTokenHash,
      );
    if (result.changes !== 1) {
      throw new Error("Configured installation not found");
    }
  }

  getByAccessTokenHash(hash: string): PluginConnection | null {
    const row = this.#database
      .query<ConnectionRow, [string]>(
        "SELECT * FROM plugin_connections WHERE access_token_hash = ?",
      )
      .get(hash);
    return this.#toConnection(row);
  }

  getByUserUuid(uuid: string): PluginConnection | null {
    const row = this.#database
      .query<ConnectionRow, [string]>(
        "SELECT * FROM plugin_connections WHERE user_uuid = ?",
      )
      .get(uuid);
    return this.#toConnection(row);
  }

  saveReading(hash: string, reading: AranetReading): void {
    const result = this.#database
      .query("UPDATE plugin_connections SET reading_json = ? WHERE access_token_hash = ?")
      .run(JSON.stringify(reading), hash);
    if (result.changes !== 1) {
      throw new Error("Plugin connection not found");
    }
  }

  deleteByUserUuid(uuid: string): boolean {
    const result = this.#database
      .query("DELETE FROM plugin_connections WHERE user_uuid = ?")
      .run(uuid);
    return result.changes === 1;
  }

  #toConnection(row: ConnectionRow | null): PluginConnection | null {
    if (
      !row?.ha_url ||
      !row.ha_token_ciphertext ||
      !row.device_json ||
      !row.user_uuid ||
      row.plugin_setting_id === null ||
      !row.instance_name ||
      !row.locale ||
      !row.time_zone
    ) {
      return null;
    }

    return {
      accessTokenHash: row.access_token_hash,
      userUuid: row.user_uuid,
      pluginSettingId: row.plugin_setting_id,
      instanceName: row.instance_name,
      locale: row.locale,
      timeZone: row.time_zone,
      configuration: {
        haUrl: row.ha_url,
        encryptedHaToken: row.ha_token_ciphertext,
        device: JSON.parse(row.device_json) as AranetDevice,
      },
      lastReading: row.reading_json
        ? (JSON.parse(row.reading_json) as AranetReading)
        : null,
    };
  }
}
