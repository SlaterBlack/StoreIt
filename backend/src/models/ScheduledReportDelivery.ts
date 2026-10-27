import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export type ScheduledReportDeliveryStatus = 'pending' | 'sent' | 'failed';

export interface ScheduledReportDeliveryAttributes {
  id: string;
  periodStart: string;
  status: ScheduledReportDeliveryStatus;
  attempts: number;
  lastAttemptAt: Date | null;
  sentAt: Date | null;
  errorMessage: string | null;
}

export class ScheduledReportDelivery
  extends Model<
    ScheduledReportDeliveryAttributes,
    Optional<ScheduledReportDeliveryAttributes, 'id' | 'status' | 'attempts'>
  >
  implements ScheduledReportDeliveryAttributes
{
  public id!: string;
  public periodStart!: string;
  public status!: ScheduledReportDeliveryStatus;
  public attempts!: number;
  public lastAttemptAt!: Date | null;
  public sentAt!: Date | null;
  public errorMessage!: string | null;
}

ScheduledReportDelivery.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    periodStart: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      unique: true,
    },
    status: {
      type: DataTypes.ENUM('pending', 'sent', 'failed'),
      allowNull: false,
      defaultValue: 'pending',
    },
    attempts: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    lastAttemptAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    sentAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'clockit_scheduled_report_deliveries',
    timestamps: true,
  },
);
