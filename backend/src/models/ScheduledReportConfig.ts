import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

export interface ScheduledReportConfigAttributes {
  id: string;
  startDate: string | null;
  frequencyUnit: 'days' | 'weeks';
  frequencyInterval: number;
  reportPeriodDays: number;
  sendWeekday: number;
  sendTime: string;
  timezone: string;
  includeAllUsers: boolean;
  includedUserIds: string[];
  recipientUserIds: string[];
  enabled: boolean;
}

export class ScheduledReportConfig
  extends Model<ScheduledReportConfigAttributes>
  implements ScheduledReportConfigAttributes
{
  public id!: string;
  public startDate!: string | null;
  public frequencyUnit!: 'days' | 'weeks';
  public frequencyInterval!: number;
  public reportPeriodDays!: number;
  public sendWeekday!: number;
  public sendTime!: string;
  public timezone!: string;
  public includeAllUsers!: boolean;
  public includedUserIds!: string[];
  public recipientUserIds!: string[];
  public enabled!: boolean;
}

ScheduledReportConfig.init(
  {
    id: {
      type: DataTypes.STRING(32),
      primaryKey: true,
      defaultValue: 'fortnightly',
    },
    startDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    frequencyUnit: {
      type: DataTypes.STRING(8),
      allowNull: false,
      defaultValue: 'weeks',
    },
    frequencyInterval: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 2,
    },
    reportPeriodDays: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 14,
    },
    sendWeekday: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 2,
    },
    sendTime: {
      type: DataTypes.STRING(5),
      allowNull: false,
      defaultValue: '13:00',
    },
    timezone: {
      type: DataTypes.STRING(64),
      allowNull: false,
      defaultValue: 'Australia/Brisbane',
    },
    includeAllUsers: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    includedUserIds: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    recipientUserIds: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    sequelize,
    tableName: 'clockit_scheduled_report_configs',
    timestamps: true,
  },
);
