import { Forma } from "forma-embedded-view-sdk/auto";
import { saveAs } from "file-saver";
import JSZip from "jszip";
import { DateTime } from "luxon";
import { useTranslation } from "../i18n/useTranslation";
import { designShadowArea, shadowOverlay } from "../shadowOverlay";

type ExportButtonProps = {
  month: number;
  day: number;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  resolution: string;
  interval: number;
};

export default function ExportButton(props: ExportButtonProps) {
  const { t } = useTranslation();
  const { month, day, startHour, startMinute, endHour, endMinute, resolution, interval } = props;

  const onClickExport = async () => {
    try {
      const projectTimezone = await Forma.project.getTimezone();
      if (!projectTimezone) {
        throw new Error("Unable to access project timezone");
      }
      const currentDate = await Forma.sun.getDate();
      const year = currentDate.getFullYear();

      const width = parseInt(resolution.split("x")[0], 10);
      const height = parseInt(resolution.split("x")[1], 10);

      const zip = new JSZip();
      const zipFolder = zip.folder("shadow-study") as JSZip;
      const areaRows: string[] = [];

      let current = DateTime.fromObject(
        {
          year,
          month,
          day,
          hour: startHour,
          minute: startMinute,
        },
        { zone: projectTimezone },
      );
      const endDate = DateTime.fromObject(
        {
          year,
          month,
          day,
          hour: endHour,
          minute: endMinute,
        },
        { zone: projectTimezone },
      );
      while (current.toMillis() <= endDate.toMillis()) {
        const date = current.toJSDate();
        await Forma.sun.setDate({ date });
        await shadowOverlay.refresh(date);
        const filename = `${current.toFormat("HH-mm")}.png`;
        const canvas = await Forma.camera.capture({ width, height });
        const data = canvas.toDataURL().split("base64,")[1];
        zipFolder.file(filename, data, { base64: true });

        const shadowArea = designShadowArea.value;
        if (shadowArea != null && shadowArea.date.getTime() === date.getTime()) {
          areaRows.push(
            `${current.toFormat("HH:mm")},${shadowArea.area != null ? Math.round(shadowArea.area) : ""}`,
          );
        }

        current = current.plus({ minutes: interval });
      }
      if (areaRows.length > 0) {
        zipFolder.file(
          "shadow-areas.csv",
          ["time,proposal_shadow_area_m2", ...areaRows].join("\n"),
        );
      }

      const dateStr =
        current.toLocaleString({ timeZone: projectTimezone, day: "2-digit" }) +
        " " +
        current.toLocaleString({ timeZone: projectTimezone, month: "long" });
      const folderName = t("export.folderName", { date: dateStr }) + ".zip";
      zipFolder.generateAsync({ type: "blob" }).then((content) => saveAs(content, folderName));

      await Forma.sun.setDate({ date: currentDate });
      await shadowOverlay.refresh(currentDate);
    } catch (e) {
      console.log(e);
    }
  };

  return (
    <div class="row">
      <weave-button variant={"solid"} onClick={onClickExport}>
        {t("actions.exportImages")}
      </weave-button>
    </div>
  );
}
